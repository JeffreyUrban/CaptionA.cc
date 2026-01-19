"""CR-SQLite working copy management with apsw.

Handles local SQLite databases with CR-SQLite extension for CRDT-based
synchronization. Manages downloading from and uploading to Wasabi S3.
"""

import asyncio
import gzip
import logging
from pathlib import Path
from typing import Any

import apsw
import boto3
from botocore.config import Config

from app.config import get_settings

logger = logging.getLogger(__name__)

# Type alias for change records
ChangeRecord = dict[str, Any]


class CRSqliteManager:
    """Manages CR-SQLite working copies on local disk.

    Handles:
    - Downloading compressed databases from Wasabi
    - Loading CR-SQLite extension with apsw
    - Applying and querying change records
    - Uploading compressed databases to Wasabi
    """

    def __init__(self):
        self._settings = get_settings()
        self._working_dir = Path(self._settings.working_copy_dir)
        self._extension_path = self._settings.crsqlite_extension_path
        self._connections: dict[str, apsw.Connection] = {}
        self._locks: dict[str, asyncio.Lock] = {}

        # Initialize S3 client for Wasabi
        self._s3 = boto3.client(
            "s3",
            endpoint_url=self._settings.wasabi_endpoint_url,
            aws_access_key_id=self._settings.effective_wasabi_access_key,
            aws_secret_access_key=self._settings.effective_wasabi_secret_key,
            region_name=self._settings.wasabi_region,
            config=Config(signature_version="s3v4"),
        )
        self._bucket = self._settings.wasabi_bucket

    def _working_path(self, tenant_id: str, video_id: str, db_name: str) -> Path:
        """Get local working copy path."""
        return self._working_dir / tenant_id / video_id / f"{db_name}.db"

    def _s3_key(self, tenant_id: str, video_id: str, db_name: str) -> str:
        """Get S3 key for gzip-compressed database in client/ path."""
        return f"{tenant_id}/client/videos/{video_id}/{db_name}.db.gz"

    def _get_lock(self, tenant_id: str, video_id: str, db_name: str) -> asyncio.Lock:
        """Get or create lock for a database."""
        key = f"{tenant_id}/{video_id}/{db_name}"
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    def has_working_copy(self, tenant_id: str, video_id: str, db_name: str) -> bool:
        """Check if working copy exists on disk."""
        return self._working_path(tenant_id, video_id, db_name).exists()

    async def download_from_wasabi(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
    ) -> Path:
        """Download and decompress database from Wasabi.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name ('layout' or 'captions')

        Returns:
            Path to local working copy
        """
        working_path = self._working_path(tenant_id, video_id, db_name)
        working_path.parent.mkdir(parents=True, exist_ok=True)
        s3_key = self._s3_key(tenant_id, video_id, db_name)

        def _download():
            logger.info(f"Downloading {s3_key} from Wasabi")
            response = self._s3.get_object(Bucket=self._bucket, Key=s3_key)
            compressed = response["Body"].read()
            decompressed = gzip.decompress(compressed)
            working_path.write_bytes(decompressed)
            logger.info(f"Downloaded and decompressed to {working_path}")

        await asyncio.to_thread(_download)
        return working_path

    async def upload_to_wasabi(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
    ) -> None:
        """Compress and upload database to Wasabi.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name
        """
        working_path = self._working_path(tenant_id, video_id, db_name)
        s3_key = self._s3_key(tenant_id, video_id, db_name)

        # Close connection before upload to ensure all data is flushed
        self._close_connection(tenant_id, video_id, db_name)

        def _upload():
            logger.info(f"Uploading {working_path} to {s3_key}")
            data = working_path.read_bytes()
            compressed = gzip.compress(data, compresslevel=6)
            self._s3.put_object(
                Bucket=self._bucket,
                Key=s3_key,
                Body=compressed,
                ContentType="application/gzip",
            )
            original_size = len(data)
            compressed_size = len(compressed)
            ratio = (
                (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
            )
            logger.info(
                f"Uploaded {s3_key}: {original_size} -> {compressed_size} bytes ({ratio:.1f}% reduction)"
            )

        await asyncio.to_thread(_upload)

    def _ensure_crr_initialized(self, conn: apsw.Connection, db_name: str) -> None:
        """Initialize tables as CRRs if not already done.

        The data pipeline creates databases with standard sqlite3 which cannot
        load extensions, so CRR initialization must happen lazily on first access.
        """
        try:
            # Check if crsql_changes exists (indicates CRR already initialized)
            conn.execute("SELECT 1 FROM crsql_changes LIMIT 1").fetchone()
        except apsw.SQLError:
            # crsql_changes doesn't exist - initialize CRRs for layout.db tables
            if db_name == "layout":
                conn.execute("SELECT crsql_as_crr('boxes')")
                conn.execute("SELECT crsql_as_crr('layout_config')")
                conn.execute("SELECT crsql_as_crr('preferences')")
                logger.info(f"Initialized CRR tables for {db_name}")
            elif db_name == "captions":
                conn.execute("SELECT crsql_as_crr('captions')")
                logger.info(f"Initialized CRR tables for {db_name}")

    def get_connection(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
    ) -> apsw.Connection:
        """Get or create CR-SQLite connection.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name

        Returns:
            apsw Connection with CR-SQLite extension loaded
        """
        key = f"{tenant_id}/{video_id}/{db_name}"

        if key not in self._connections:
            working_path = self._working_path(tenant_id, video_id, db_name)

            if not working_path.exists():
                raise FileNotFoundError(f"Working copy not found: {working_path}")

            conn = apsw.Connection(str(working_path))

            # Load CR-SQLite extension if path is configured
            if self._extension_path:
                conn.enableloadextension(True)
                conn.loadextension(self._extension_path, "sqlite3_crsqlite_init")
                conn.enableloadextension(False)

                # Ensure CRR tables are initialized (lazy migration)
                self._ensure_crr_initialized(conn, db_name)

            # Configure for durability
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")

            self._connections[key] = conn
            logger.debug(f"Created connection for {key}")

        return self._connections[key]

    def _close_connection(self, tenant_id: str, video_id: str, db_name: str) -> None:
        """Close connection if open."""
        key = f"{tenant_id}/{video_id}/{db_name}"
        if key in self._connections:
            conn = self._connections.pop(key)
            try:
                # Finalize CR-SQLite before closing
                conn.execute("SELECT crsql_finalize()")
            except Exception:
                pass  # May fail if extension not loaded
            conn.close()
            logger.debug(f"Closed connection for {key}")

    async def apply_changes(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
        changes: list[ChangeRecord],
    ) -> int:
        """Apply CR-SQLite changes to working copy.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name
            changes: List of change records from client

        Returns:
            New db_version after applying changes
        """
        conn = self.get_connection(tenant_id, video_id, db_name)

        def _apply():
            cursor = conn.cursor()
            try:
                cursor.execute("BEGIN")
                for change in changes:
                    cursor.execute(
                        """
                        INSERT INTO crsql_changes
                        ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            change["table"],
                            change["pk"],
                            change["cid"],
                            change["val"],
                            change["col_version"],
                            change["db_version"],
                            change["site_id"],
                            change["cl"],
                            change["seq"],
                        ),
                    )
                cursor.execute("COMMIT")

                # Get new version
                result = cursor.execute("SELECT crsql_db_version()").fetchone()
                return result[0] if result else 0
            except Exception:
                cursor.execute("ROLLBACK")
                raise

        return await asyncio.to_thread(_apply)

    async def get_changes_since(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
        since_version: int,
        exclude_site_id: bytes | None = None,
    ) -> list[ChangeRecord]:
        """Get changes since a specific version.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name
            since_version: Version to get changes after
            exclude_site_id: Optional site_id to exclude (avoids echo of own changes)

        Returns:
            List of change records
        """
        conn = self.get_connection(tenant_id, video_id, db_name)

        def _query():
            cursor = conn.cursor()
            if exclude_site_id:
                # Filter out changes from the specified site (avoid echo)
                rows = cursor.execute(
                    """
                    SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
                    FROM crsql_changes
                    WHERE db_version > ? AND site_id IS NOT ?
                    ORDER BY db_version, seq
                    """,
                    (since_version, exclude_site_id),
                ).fetchall()
            else:
                # No filter - used for server-initiated pushes
                rows = cursor.execute(
                    """
                    SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
                    FROM crsql_changes
                    WHERE db_version > ?
                    ORDER BY db_version, seq
                    """,
                    (since_version,),
                ).fetchall()

            return [
                {
                    "table": row[0],
                    "pk": row[1],
                    "cid": row[2],
                    "val": row[3],
                    "col_version": row[4],
                    "db_version": row[5],
                    "site_id": row[6],
                    "cl": row[7],
                    "seq": row[8],
                }
                for row in rows
            ]

        return await asyncio.to_thread(_query)

    async def get_db_version(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
    ) -> int:
        """Get current database version.

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name

        Returns:
            Current db_version
        """
        conn = self.get_connection(tenant_id, video_id, db_name)

        def _query():
            result = conn.execute("SELECT crsql_db_version()").fetchone()
            return result[0] if result else 0

        return await asyncio.to_thread(_query)

    async def initialize_crr_tables(
        self,
        tenant_id: str,
        video_id: str,
        db_name: str,
        tables: list[str],
    ) -> None:
        """Initialize tables as CRR (conflict-free replicated relations).

        Args:
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name
            tables: List of table names to enable CR-SQLite on
        """
        conn = self.get_connection(tenant_id, video_id, db_name)

        def _init():
            cursor = conn.cursor()
            for table in tables:
                cursor.execute(f"SELECT crsql_as_crr('{table}')")
            logger.info(f"Initialized CRR tables for {db_name}: {tables}")

        await asyncio.to_thread(_init)

    def close_all_connections(self) -> None:
        """Close all open connections. Call on shutdown."""
        for key in list(self._connections.keys()):
            parts = key.split("/")
            if len(parts) == 3:
                self._close_connection(parts[0], parts[1], parts[2])
        logger.info("Closed all CR-SQLite connections")


# Singleton instance
_crsqlite_manager: CRSqliteManager | None = None


def get_crsqlite_manager() -> CRSqliteManager:
    """Get singleton CRSqliteManager."""
    global _crsqlite_manager
    if _crsqlite_manager is None:
        _crsqlite_manager = CRSqliteManager()
    return _crsqlite_manager
