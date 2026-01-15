"""Background tasks for periodic Wasabi uploads.

Handles:
- Idle timeout uploads (no activity for N minutes)
- Checkpoint uploads (periodic backup)
- Graceful shutdown uploads (SIGTERM)
"""

import asyncio
import logging

from app.config import get_settings
from app.services.crsqlite_manager import get_crsqlite_manager
from app.services.supabase_client import DatabaseStateRepository

logger = logging.getLogger(__name__)


class WasabiUploadWorker:
    """Background worker for periodic Wasabi uploads.

    Runs every minute to check for databases needing upload:
    - Idle: No activity for `wasabi_upload_idle_minutes`
    - Checkpoint: No upload for `wasabi_upload_checkpoint_minutes`

    Also handles graceful shutdown by uploading all pending changes.
    """

    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None
        self._settings = get_settings()

    async def start(self) -> None:
        """Start background worker."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Wasabi upload worker started")

    async def stop(self) -> None:
        """Stop background worker and upload pending changes."""
        self._running = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        # Upload all pending on shutdown
        await self._upload_all_pending()
        logger.info("Wasabi upload worker stopped")

    async def _run_loop(self) -> None:
        """Main worker loop - runs every minute."""
        while self._running:
            try:
                await self._check_and_upload()
            except Exception as e:
                logger.error(f"Wasabi upload worker error: {e}")

            # Wait 60 seconds before next check
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break

    async def _cleanup_stale_locks(self, repo: DatabaseStateRepository) -> None:
        """Release locks that have been held too long without activity."""
        try:
            released = await repo.release_stale_locks(
                stale_minutes=self._settings.lock_expiry_minutes
            )
            if released:
                logger.info(f"Released {len(released)} stale locks")
                for state in released:
                    logger.info(
                        f"  Released stale lock: {state.get('video_id')}/{state.get('database_name')} "
                        f"(held by {state.get('lock_holder_user_id')})"
                    )
        except Exception as e:
            logger.error(f"Failed to cleanup stale locks: {e}")

    async def _check_and_upload(self) -> None:
        """Check for databases needing upload and clean up stale locks."""
        repo = DatabaseStateRepository()
        cr_manager = get_crsqlite_manager()

        # Clean up stale locks first
        await self._cleanup_stale_locks(repo)

        pending = await repo.get_pending_uploads(
            idle_minutes=self._settings.wasabi_upload_idle_minutes,
            checkpoint_minutes=self._settings.wasabi_upload_checkpoint_minutes,
        )

        if not pending:
            return

        logger.info(f"Found {len(pending)} databases needing upload")

        for state in pending:
            video_id = state.get("video_id")
            db_name = state.get("database_name")
            tenant_id = state.get("tenant_id")
            server_version = state.get("server_version", 0)

            if not video_id or not db_name or not tenant_id:
                continue

            # Check if working copy exists
            if not cr_manager.has_working_copy(tenant_id, video_id, db_name):
                logger.warning(
                    f"No working copy for {video_id}/{db_name}, skipping upload"
                )
                continue

            try:
                logger.info(f"Uploading {video_id}/{db_name} to Wasabi")
                await cr_manager.upload_to_wasabi(tenant_id, video_id, db_name)
                await repo.update_wasabi_version(video_id, db_name, server_version)
                logger.info(f"Uploaded {video_id}/{db_name} version {server_version}")
            except Exception as e:
                logger.error(f"Failed to upload {video_id}/{db_name}: {e}")

    async def _upload_all_pending(self) -> None:
        """Upload all databases with unsaved changes (for shutdown)."""
        repo = DatabaseStateRepository()
        cr_manager = get_crsqlite_manager()

        pending = await repo.get_all_with_unsaved_changes()

        if not pending:
            logger.info("No pending uploads on shutdown")
            return

        logger.info(f"Uploading {len(pending)} databases on shutdown")

        for state in pending:
            video_id = state.get("video_id")
            db_name = state.get("database_name")
            tenant_id = state.get("tenant_id")
            server_version = state.get("server_version", 0)

            if not video_id or not db_name or not tenant_id:
                continue

            if not cr_manager.has_working_copy(tenant_id, video_id, db_name):
                continue

            try:
                logger.info(f"Shutdown upload: {video_id}/{db_name}")
                await cr_manager.upload_to_wasabi(tenant_id, video_id, db_name)
                await repo.update_wasabi_version(video_id, db_name, server_version)
            except Exception as e:
                logger.error(f"Shutdown upload failed for {video_id}/{db_name}: {e}")

        # Close all connections
        cr_manager.close_all_connections()


# Singleton instance
_upload_worker: WasabiUploadWorker | None = None


def get_upload_worker() -> WasabiUploadWorker:
    """Get singleton upload worker."""
    global _upload_worker
    if _upload_worker is None:
        _upload_worker = WasabiUploadWorker()
    return _upload_worker
