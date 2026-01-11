"""Database manager for SQLite databases stored in Wasabi S3.

Handles downloading, caching, and uploading of per-video SQLite databases.
Uses LRU cache to minimize S3 operations.
"""

import asyncio
import hashlib
import shutil
import sqlite3
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

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
        self._s3 = boto3.client(
            "s3",
            endpoint_url=self._settings.wasabi_endpoint_url,
            aws_access_key_id=self._settings.wasabi_access_key_id,
            aws_secret_access_key=self._settings.wasabi_secret_access_key,
            region_name=self._settings.wasabi_region,
        )
        self._bucket = self._settings.wasabi_bucket

    def _get_lock(self, key: str) -> asyncio.Lock:
        """Get or create a lock for a specific database."""
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    def _s3_key(self, tenant_id: str, video_id: str, db_name: str = "captions.db") -> str:
        """Generate S3 key for a database file."""
        return f"{tenant_id}/videos/{video_id}/{db_name}"

    def _cache_path(self, tenant_id: str, video_id: str, db_name: str = "captions.db") -> Path:
        """Generate local cache path for a database file."""
        # Use hash to avoid path length issues
        key = f"{tenant_id}/{video_id}/{db_name}"
        hashed = hashlib.md5(key.encode()).hexdigest()[:16]
        return self._cache_dir / f"{hashed}_{db_name}"

    async def _download_from_s3(self, s3_key: str, local_path: Path) -> bool:
        """Download a file from S3 to local cache."""

        def _download():
            try:
                self._s3.download_file(self._bucket, s3_key, str(local_path))
                return True
            except ClientError as e:
                if e.response["Error"]["Code"] == "404":
                    return False
                raise

        return await asyncio.to_thread(_download)

    async def _upload_to_s3(self, local_path: Path, s3_key: str) -> None:
        """Upload a file from local cache to S3."""

        def _upload():
            self._s3.upload_file(str(local_path), self._bucket, s3_key)

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
                        boundary_state TEXT NOT NULL DEFAULT 'predicted'
                            CHECK (boundary_state IN ('predicted', 'confirmed', 'gap')),
                        boundary_pending INTEGER NOT NULL DEFAULT 1,
                        boundary_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        text TEXT,
                        text_pending INTEGER NOT NULL DEFAULT 1,
                        text_status TEXT,
                        text_notes TEXT,
                        text_ocr_combined TEXT,
                        text_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        image_needs_regen INTEGER NOT NULL DEFAULT 0,
                        median_ocr_status TEXT NOT NULL DEFAULT 'queued',
                        median_ocr_error TEXT,
                        median_ocr_processed_at TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );

                    -- Index for frame range queries
                    CREATE INDEX IF NOT EXISTS idx_captions_frame_range
                        ON captions(start_frame_index, end_frame_index);

                    -- Index for workable items (gaps or pending)
                    CREATE INDEX IF NOT EXISTS idx_captions_workable
                        ON captions(boundary_state, boundary_pending);
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


# Singleton instance
_database_manager: DatabaseManager | None = None


def get_database_manager() -> DatabaseManager:
    """Get the singleton DatabaseManager instance."""
    global _database_manager
    if _database_manager is None:
        _database_manager = DatabaseManager()
    return _database_manager
