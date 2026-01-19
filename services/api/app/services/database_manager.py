"""Database manager for SQLite databases stored in Wasabi S3.

Handles downloading, caching, and uploading of per-video SQLite databases.
Uses LRU cache to minimize S3 operations.
"""

import asyncio
import hashlib
import logging
import shutil
import sqlite3
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

import boto3
from botocore.exceptions import ClientError

from app.config import Settings, get_settings


class DatabaseManager:
    """Manages SQLite databases stored in Wasabi S3 with local LRU caching."""

    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._cache_dir = Path(self._settings.sqlite_cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._max_cache_size = self._settings.sqlite_cache_max_size_mb * 1024 * 1024
        self._lru_order: OrderedDict[str, int] = OrderedDict()  # path -> size
        self._current_cache_size = 0
        self._locks: dict[str, asyncio.Lock] = {}

        # Initialize S3 client for Wasabi
        access_key = self._settings.effective_wasabi_access_key
        secret_key = self._settings.effective_wasabi_secret_key
        logger.info(
            f"Initializing S3 client: "
            f"endpoint={self._settings.wasabi_endpoint_url}, "
            f"region={self._settings.wasabi_region}, "
            f"bucket={self._settings.wasabi_bucket}, "
            f"access_key_set={bool(access_key)}, "
            f"access_key_len={len(access_key) if access_key else 0}, "
            f"secret_key_set={bool(secret_key)}"
        )
        self._s3 = boto3.client(
            "s3",
            endpoint_url=self._settings.wasabi_endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=self._settings.wasabi_region,
        )
        self._bucket = self._settings.wasabi_bucket

    def _get_lock(self, key: str) -> asyncio.Lock:
        """Get or create a lock for a specific database."""
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    def _s3_key(
        self, tenant_id: str, video_id: str, db_name: str = "captions.db"
    ) -> str:
        """Generate S3 key for a database file in client/ path."""
        return f"{tenant_id}/client/videos/{video_id}/{db_name}"

    def _cache_path(
        self, tenant_id: str, video_id: str, db_name: str = "captions.db"
    ) -> Path:
        """Generate local cache path for a database file."""
        # Use hash to avoid path length issues
        key = f"{tenant_id}/{video_id}/{db_name}"
        hashed = hashlib.md5(key.encode()).hexdigest()[:16]
        return self._cache_dir / f"{hashed}_{db_name}"

    async def _download_from_s3(self, s3_key: str, local_path: Path) -> bool:
        """Download a file from S3 to local cache, decompressing if needed."""
        import gzip
        import tempfile

        def _download():
            try:
                logger.info(f"Attempting to download from S3: bucket={self._bucket}, key={s3_key}")
                # Check if we need to download a compressed version
                is_compressed = s3_key.endswith(".gz")
                download_path = local_path if not is_compressed else Path(str(local_path) + ".gz")

                self._s3.download_file(self._bucket, s3_key, str(download_path))

                # Decompress if needed
                if is_compressed:
                    with gzip.open(download_path, "rb") as f_in:
                        with open(local_path, "wb") as f_out:
                            f_out.write(f_in.read())
                    # Clean up compressed file
                    download_path.unlink()

                return True
            except ClientError as e:
                if e.response["Error"]["Code"] == "404":
                    return False
                raise

        return await asyncio.to_thread(_download)

    async def _upload_to_s3(self, local_path: Path, s3_key: str) -> None:
        """Upload a file from local cache to S3, compressed with gzip."""
        import gzip
        import tempfile

        def _upload():
            # Compress the database before uploading
            with tempfile.NamedTemporaryFile(suffix=".gz", delete=False) as tmp:
                compressed_path = Path(tmp.name)

            try:
                with open(local_path, "rb") as f_in:
                    with gzip.open(compressed_path, "wb") as f_out:
                        f_out.writelines(f_in)

                # Upload compressed file with .gz extension
                s3_key_gz = f"{s3_key}.gz" if not s3_key.endswith(".gz") else s3_key
                self._s3.upload_file(
                    str(compressed_path),
                    self._bucket,
                    s3_key_gz,
                    ExtraArgs={"ContentType": "application/gzip"}
                )
            finally:
                # Clean up temporary compressed file
                if compressed_path.exists():
                    compressed_path.unlink()

        await asyncio.to_thread(_upload)

    def _evict_if_needed(self, new_file_size: int) -> None:
        """Evict oldest files from cache if needed to make room."""
        while (
            self._current_cache_size + new_file_size > self._max_cache_size
            and self._lru_order
        ):
            oldest_path, oldest_size = self._lru_order.popitem(last=False)
            cache_file = Path(oldest_path)
            if cache_file.exists():
                cache_file.unlink()
            self._current_cache_size -= oldest_size

    def _update_lru(self, cache_path: Path) -> None:
        """Update LRU order for a cache file."""
        path_str = str(cache_path)
        if path_str in self._lru_order:
            # Move to end (most recently used)
            self._lru_order.move_to_end(path_str)
        else:
            # Add new entry
            if cache_path.exists():
                size = cache_path.stat().st_size
                self._evict_if_needed(size)
                self._lru_order[path_str] = size
                self._current_cache_size += size

    @asynccontextmanager
    async def get_database(
        self, tenant_id: str, video_id: str, writable: bool = False
    ) -> AsyncGenerator[sqlite3.Connection, None]:
        """
        Get a SQLite database connection with automatic S3 sync.

        Downloads from S3 if not cached. Uploads back to S3 after writes.
        Uses per-database locking for thread safety.

        Args:
            tenant_id: Tenant identifier for isolation
            video_id: Video identifier
            writable: If True, upload changes back to S3 after context exits

        Yields:
            SQLite connection object
        """
        s3_key = self._s3_key(tenant_id, video_id)
        cache_path = self._cache_path(tenant_id, video_id)
        lock = self._get_lock(s3_key)

        async with lock:
            # Download from S3 if not in cache
            if not cache_path.exists():
                downloaded = await self._download_from_s3(s3_key, cache_path)
                if not downloaded:
                    raise FileNotFoundError(f"Database not found: {s3_key}")

            self._update_lru(cache_path)

            # Open connection
            conn = sqlite3.connect(str(cache_path))
            conn.row_factory = sqlite3.Row

            try:
                yield conn
            finally:
                conn.close()

                # Upload back to S3 if writable
                if writable:
                    await self._upload_to_s3(cache_path, s3_key)

    @asynccontextmanager
    async def get_or_create_database(
        self, tenant_id: str, video_id: str
    ) -> AsyncGenerator[sqlite3.Connection, None]:
        """
        Get or create a SQLite database with automatic S3 sync.

        Creates a new database with schema if it doesn't exist.

        Args:
            tenant_id: Tenant identifier for isolation
            video_id: Video identifier

        Yields:
            SQLite connection object
        """
        s3_key = self._s3_key(tenant_id, video_id)
        cache_path = self._cache_path(tenant_id, video_id)
        lock = self._get_lock(s3_key)
        created = False

        async with lock:
            # Download from S3 if not in cache
            if not cache_path.exists():
                downloaded = await self._download_from_s3(s3_key, cache_path)
                if not downloaded:
                    # Create new database with schema
                    created = True
                    await self._create_new_database(cache_path)

            self._update_lru(cache_path)

            # Open connection
            conn = sqlite3.connect(str(cache_path))
            conn.row_factory = sqlite3.Row

            try:
                yield conn
            finally:
                conn.close()

                # Upload to S3 if created or modified
                if created:
                    await self._upload_to_s3(cache_path, s3_key)

    async def _create_new_database(self, cache_path: Path) -> None:
        """Create a new captions database with schema."""

        def _create():
            conn = sqlite3.connect(str(cache_path))
            try:
                conn.executescript(
                    """
                    -- Database metadata for migrations
                    CREATE TABLE IF NOT EXISTS database_metadata (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );
                    INSERT OR REPLACE INTO database_metadata (key, value) VALUES ('schema_version', '2');

                    -- Main captions table
                    CREATE TABLE IF NOT EXISTS captions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        start_frame_index INTEGER NOT NULL,
                        end_frame_index INTEGER NOT NULL,
                        caption_frame_extents_state TEXT NOT NULL DEFAULT 'predicted'
                            CHECK (caption_frame_extents_state IN ('predicted', 'confirmed', 'gap')),
                        caption_frame_extents_pending INTEGER NOT NULL DEFAULT 1,
                        caption_frame_extents_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        text TEXT,
                        text_pending INTEGER NOT NULL DEFAULT 1,
                        text_status TEXT,
                        text_notes TEXT,
                        caption_ocr TEXT,
                        text_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        image_needs_regen INTEGER NOT NULL DEFAULT 0,
                        caption_ocr_status TEXT NOT NULL DEFAULT 'queued',
                        caption_ocr_error TEXT,
                        caption_ocr_processed_at TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );

                    -- Index for frame range queries
                    CREATE INDEX IF NOT EXISTS idx_captions_frame_range
                        ON captions(start_frame_index, end_frame_index);

                    -- Index for workable items (gaps or pending)
                    CREATE INDEX IF NOT EXISTS idx_captions_workable
                        ON captions(caption_frame_extents_state, caption_frame_extents_pending);
                    """
                )
                conn.commit()
            finally:
                conn.close()

        await asyncio.to_thread(_create)

    async def invalidate_cache(self, tenant_id: str, video_id: str) -> None:
        """Remove a database from the local cache."""
        cache_path = self._cache_path(tenant_id, video_id)
        path_str = str(cache_path)

        if path_str in self._lru_order:
            self._current_cache_size -= self._lru_order.pop(path_str)

        if cache_path.exists():
            cache_path.unlink()

    async def clear_cache(self) -> None:
        """Clear the entire local cache."""
        self._lru_order.clear()
        self._current_cache_size = 0
        shutil.rmtree(self._cache_dir, ignore_errors=True)
        self._cache_dir.mkdir(parents=True, exist_ok=True)


class LayoutDatabaseManager(DatabaseManager):
    """Manages layout.db SQLite databases stored in Wasabi S3."""

    def _s3_key(self, tenant_id: str, video_id: str, db_name: str = "layout.db.gz") -> str:
        """Generate S3 key for a layout database file in client/ path."""
        return f"{tenant_id}/client/videos/{video_id}/{db_name}"

    def _cache_path(
        self, tenant_id: str, video_id: str, db_name: str = "layout.db"
    ) -> Path:
        """Generate local cache path for a layout database file."""
        key = f"{tenant_id}/{video_id}/{db_name}"
        hashed = hashlib.md5(key.encode()).hexdigest()[:16]
        return self._cache_dir / f"{hashed}_{db_name}"

    async def _create_new_database(self, cache_path: Path) -> None:
        """Create a new layout database with schema."""

        def _create():
            conn = sqlite3.connect(str(cache_path))
            try:
                conn.executescript(
                    """
                    -- Database metadata for schema versioning
                    CREATE TABLE IF NOT EXISTS database_metadata (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        schema_version INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        migrated_at TEXT
                    );
                    INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1);

                    -- Video layout configuration
                    CREATE TABLE IF NOT EXISTS video_layout_config (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        frame_width INTEGER NOT NULL,
                        frame_height INTEGER NOT NULL,
                        crop_left INTEGER NOT NULL DEFAULT 0,
                        crop_top INTEGER NOT NULL DEFAULT 0,
                        crop_right INTEGER NOT NULL DEFAULT 0,
                        crop_bottom INTEGER NOT NULL DEFAULT 0,
                        selection_left INTEGER,
                        selection_top INTEGER,
                        selection_right INTEGER,
                        selection_bottom INTEGER,
                        selection_mode TEXT NOT NULL DEFAULT 'disabled',
                        vertical_position REAL,
                        vertical_std REAL,
                        box_height REAL,
                        box_height_std REAL,
                        anchor_type TEXT,
                        anchor_position REAL,
                        top_edge_std REAL,
                        bottom_edge_std REAL,
                        horizontal_std_slope REAL,
                        horizontal_std_intercept REAL,
                        crop_region_version INTEGER NOT NULL DEFAULT 1,
                        analysis_model_version TEXT,
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );

                    -- Box classification labels
                    CREATE TABLE IF NOT EXISTS full_frame_box_labels (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        frame_index INTEGER NOT NULL,
                        box_index INTEGER NOT NULL,
                        label TEXT NOT NULL CHECK (label IN ('in', 'out')),
                        label_source TEXT NOT NULL DEFAULT 'user' CHECK (label_source IN ('user', 'model')),
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        UNIQUE(frame_index, box_index, label_source)
                    );
                    CREATE INDEX IF NOT EXISTS idx_box_labels_frame ON full_frame_box_labels(frame_index);

                    -- Box classification model storage
                    CREATE TABLE IF NOT EXISTS box_classification_model (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        model_data BLOB,
                        model_version TEXT,
                        trained_at TEXT
                    );

                    -- Video preferences
                    CREATE TABLE IF NOT EXISTS video_preferences (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        layout_approved INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                conn.commit()
            finally:
                conn.close()

        await asyncio.to_thread(_create)


class OcrDatabaseManager(DatabaseManager):
    """Manages fullOCR.db SQLite databases stored in Wasabi S3 (read-only)."""

    def _s3_key(
        self, tenant_id: str, video_id: str, db_name: str = "fullOCR.db"
    ) -> str:
        """Generate S3 key for an OCR database file in server/ path."""
        return f"{tenant_id}/server/videos/{video_id}/{db_name}"

    def _cache_path(
        self, tenant_id: str, video_id: str, db_name: str = "fullOCR.db"
    ) -> Path:
        """Generate local cache path for an OCR database file."""
        key = f"{tenant_id}/{video_id}/{db_name}"
        hashed = hashlib.md5(key.encode()).hexdigest()[:16]
        return self._cache_dir / f"{hashed}_{db_name}"

    async def _create_new_database(self, cache_path: Path) -> None:
        """Create a new OCR database with schema.

        Note: OCR databases are typically created by the processing pipeline,
        but we provide schema creation for testing purposes.
        """

        def _create():
            conn = sqlite3.connect(str(cache_path))
            try:
                conn.executescript(
                    """
                    -- Database metadata for schema versioning
                    CREATE TABLE IF NOT EXISTS database_metadata (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        schema_version INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        migrated_at TEXT
                    );
                    INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1);

                    -- OCR detection results
                    CREATE TABLE IF NOT EXISTS full_frame_ocr (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        frame_id INTEGER NOT NULL,
                        frame_index INTEGER NOT NULL,
                        box_index INTEGER NOT NULL,
                        text TEXT,
                        confidence REAL,
                        bbox_left INTEGER,
                        bbox_top INTEGER,
                        bbox_right INTEGER,
                        bbox_bottom INTEGER,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX IF NOT EXISTS idx_frame_index ON full_frame_ocr(frame_index);
                    """
                )
                conn.commit()
            finally:
                conn.close()

        await asyncio.to_thread(_create)


# Singleton instances
_database_manager: DatabaseManager | None = None
_layout_database_manager: LayoutDatabaseManager | None = None
_ocr_database_manager: OcrDatabaseManager | None = None


def get_database_manager() -> DatabaseManager:
    """Get the singleton DatabaseManager instance for captions.db."""
    global _database_manager
    if _database_manager is None:
        _database_manager = DatabaseManager()
    return _database_manager


def get_layout_database_manager() -> LayoutDatabaseManager:
    """Get the singleton LayoutDatabaseManager instance for layout.db."""
    global _layout_database_manager
    if _layout_database_manager is None:
        _layout_database_manager = LayoutDatabaseManager()
    return _layout_database_manager


def get_ocr_database_manager() -> OcrDatabaseManager:
    """Get the singleton OcrDatabaseManager instance for fullOCR.db."""
    global _ocr_database_manager
    if _ocr_database_manager is None:
        _ocr_database_manager = OcrDatabaseManager()
    return _ocr_database_manager
