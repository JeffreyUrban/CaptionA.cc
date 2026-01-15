"""Supabase client for video_database_state management.

Handles lock acquisition, version tracking, and state management
for the CR-SQLite sync protocol.
"""

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.config import get_settings

# Type alias for database state records
StateDict = dict[str, Any]


@lru_cache
def get_supabase_client() -> Client:
    """Get cached Supabase client for API service."""
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )


class DatabaseStateRepository:
    """Repository for video_database_state operations.

    Manages lock acquisition, version tracking, and state for CR-SQLite sync.
    """

    def __init__(self, client: Client | None = None):
        self._client = client or get_supabase_client()
        self._schema = get_settings().supabase_schema

    def _table(self):
        """Get the video_database_state table reference."""
        return self._client.schema(self._schema).table("video_database_state")

    def _extract_single(self, response) -> StateDict | None:  # noqa: ANN001
        """Extract single record from response."""
        data = response.data
        if data is None:
            return None
        if isinstance(data, dict):
            return data
        return None

    def _extract_first(self, response) -> StateDict:  # noqa: ANN001
        """Extract first record from list response."""
        data = response.data
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]  # type: ignore[return-value]
        return {}

    def _extract_list(self, response) -> list[StateDict]:  # noqa: ANN001
        """Extract list of records from response."""
        data = response.data
        if data and isinstance(data, list):
            return data  # type: ignore[return-value]
        return []

    async def get_state(self, video_id: str, db_name: str) -> StateDict | None:
        """Get database state for a video.

        Args:
            video_id: Video UUID
            db_name: Database name ('layout' or 'captions')

        Returns:
            State dict or None if not found
        """
        response = (
            self._table()
            .select("*")
            .eq("video_id", video_id)
            .eq("database_name", db_name)
            .maybe_single()
            .execute()
        )
        return self._extract_single(response)

    async def create_state(
        self,
        video_id: str,
        db_name: str,
        tenant_id: str,
    ) -> StateDict:
        """Create initial database state record.

        Args:
            video_id: Video UUID
            db_name: Database name ('layout' or 'captions')
            tenant_id: Tenant UUID for RLS

        Returns:
            Created state dict
        """
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "video_id": video_id,
            "database_name": db_name,
            "tenant_id": tenant_id,
            "server_version": 0,
            "wasabi_version": 0,
            "wasabi_synced_at": now,
            "lock_holder_user_id": None,
            "lock_type": None,
            "locked_at": None,
            "last_activity_at": now,
            "active_connection_id": None,
            "working_copy_path": None,
        }
        response = self._table().insert(data).execute()
        return self._extract_first(response)

    async def get_or_create_state(
        self,
        video_id: str,
        db_name: str,
        tenant_id: str,
    ) -> StateDict:
        """Get existing state or create if not exists.

        Args:
            video_id: Video UUID
            db_name: Database name
            tenant_id: Tenant UUID

        Returns:
            State dict
        """
        state = await self.get_state(video_id, db_name)
        if state is None:
            state = await self.create_state(video_id, db_name, tenant_id)
        return state

    async def acquire_lock(
        self,
        video_id: str,
        db_name: str,
        user_id: str,
        connection_id: str,
        tenant_id: str,
    ) -> StateDict:
        """Acquire or transfer lock to user.

        Args:
            video_id: Video UUID
            db_name: Database name
            user_id: User acquiring the lock
            connection_id: WebSocket connection ID
            tenant_id: Tenant UUID

        Returns:
            Updated state dict
        """
        # Ensure state exists
        await self.get_or_create_state(video_id, db_name, tenant_id)

        now = datetime.now(timezone.utc).isoformat()
        response = (
            self._table()
            .update({
                "lock_holder_user_id": user_id,
                "lock_type": "client",
                "locked_at": now,
                "last_activity_at": now,
                "active_connection_id": connection_id,
            })
            .eq("video_id", video_id)
            .eq("database_name", db_name)
            .execute()
        )
        return self._extract_first(response)

    async def release_lock(self, video_id: str, db_name: str) -> StateDict:
        """Release lock on database.

        Args:
            video_id: Video UUID
            db_name: Database name

        Returns:
            Updated state dict
        """
        response = (
            self._table()
            .update({
                "lock_holder_user_id": None,
                "lock_type": None,
                "locked_at": None,
                "active_connection_id": None,
            })
            .eq("video_id", video_id)
            .eq("database_name", db_name)
            .execute()
        )
        return self._extract_first(response)

    async def update_activity(self, video_id: str, db_name: str) -> None:
        """Update last_activity_at timestamp.

        Args:
            video_id: Video UUID
            db_name: Database name
        """
        now = datetime.now(timezone.utc).isoformat()
        self._table().update({"last_activity_at": now}).eq("video_id", video_id).eq(
            "database_name", db_name
        ).execute()

    async def increment_server_version(self, video_id: str, db_name: str) -> int:
        """Increment and return new server_version.

        Args:
            video_id: Video UUID
            db_name: Database name

        Returns:
            New server version
        """
        # Get current version
        state = await self.get_state(video_id, db_name)
        if not state:
            return 0

        new_version = state.get("server_version", 0) + 1

        self._table().update({"server_version": new_version}).eq("video_id", video_id).eq(
            "database_name", db_name
        ).execute()

        return new_version

    async def update_wasabi_version(
        self,
        video_id: str,
        db_name: str,
        version: int,
    ) -> None:
        """Update wasabi_version after upload.

        Args:
            video_id: Video UUID
            db_name: Database name
            version: Version that was uploaded
        """
        now = datetime.now(timezone.utc).isoformat()
        self._table().update({
            "wasabi_version": version,
            "wasabi_synced_at": now,
        }).eq("video_id", video_id).eq("database_name", db_name).execute()

    async def set_working_copy_path(
        self,
        video_id: str,
        db_name: str,
        path: str | None,
    ) -> None:
        """Set the working copy path on server.

        Args:
            video_id: Video UUID
            db_name: Database name
            path: Local filesystem path or None to clear
        """
        self._table().update({"working_copy_path": path}).eq("video_id", video_id).eq(
            "database_name", db_name
        ).execute()

    async def get_pending_uploads(
        self,
        idle_minutes: int,
        checkpoint_minutes: int,
    ) -> list[StateDict]:
        """Get databases with unsaved changes needing upload.

        Args:
            idle_minutes: Minutes of idle time before upload
            checkpoint_minutes: Max minutes between uploads

        Returns:
            List of state dicts needing upload
        """
        response = (
            self._table()
            .select("*")
            .gt("server_version", 0)  # Has some changes
            .execute()
        )

        all_states = self._extract_list(response)
        if not all_states:
            return []

        now = datetime.now(timezone.utc)
        pending = []

        for state in all_states:
            server_ver = state.get("server_version", 0)
            wasabi_ver = state.get("wasabi_version", 0)

            # Skip if already synced
            if server_ver <= wasabi_ver:
                continue

            last_activity = state.get("last_activity_at")
            wasabi_synced = state.get("wasabi_synced_at")

            # Check idle timeout
            if last_activity:
                last_activity_dt = datetime.fromisoformat(
                    str(last_activity).replace("Z", "+00:00")
                )
                idle_seconds = (now - last_activity_dt).total_seconds()
                if idle_seconds >= idle_minutes * 60:
                    pending.append(state)
                    continue

            # Check checkpoint timeout
            if wasabi_synced:
                wasabi_synced_dt = datetime.fromisoformat(
                    str(wasabi_synced).replace("Z", "+00:00")
                )
                checkpoint_seconds = (now - wasabi_synced_dt).total_seconds()
                if checkpoint_seconds >= checkpoint_minutes * 60:
                    pending.append(state)

        return pending

    async def get_all_with_unsaved_changes(self) -> list[StateDict]:
        """Get all databases with unsaved changes (for shutdown).

        Returns:
            List of state dicts with server_version > wasabi_version
        """
        response = self._table().select("*").execute()
        all_states = self._extract_list(response)

        return [
            state
            for state in all_states
            if state.get("server_version", 0) > state.get("wasabi_version", 0)
        ]

    async def get_stale_locks(self, stale_minutes: int) -> list[StateDict]:
        """Get locks that have been held too long without activity.

        Args:
            stale_minutes: Minutes of inactivity before lock is considered stale

        Returns:
            List of state dicts with stale locks
        """
        response = (
            self._table()
            .select("*")
            .not_.is_("lock_holder_user_id", "null")
            .execute()
        )

        all_locked = self._extract_list(response)
        if not all_locked:
            return []

        now = datetime.now(timezone.utc)
        stale = []

        for state in all_locked:
            last_activity = state.get("last_activity_at")
            if not last_activity:
                continue

            last_activity_dt = datetime.fromisoformat(
                str(last_activity).replace("Z", "+00:00")
            )
            idle_seconds = (now - last_activity_dt).total_seconds()
            if idle_seconds >= stale_minutes * 60:
                stale.append(state)

        return stale

    async def release_stale_locks(self, stale_minutes: int) -> list[StateDict]:
        """Release all stale locks and return them.

        Args:
            stale_minutes: Minutes of inactivity before lock is considered stale

        Returns:
            List of state dicts for released locks
        """
        stale = await self.get_stale_locks(stale_minutes)

        released = []
        for state in stale:
            video_id = state.get("video_id")
            db_name = state.get("database_name")
            if video_id and db_name:
                await self.release_lock(video_id, db_name)
                released.append(state)

        return released
