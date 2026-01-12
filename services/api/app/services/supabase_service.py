"""
Supabase service interface and implementation.
Handles all database operations for video processing workflows.
"""
from typing import Optional, Protocol


class SupabaseService(Protocol):
    """
    Interface for Supabase database operations.
    Use Protocol for structural typing - implementations don't need to inherit.
    """

    # Video status updates
    def update_video_status(
        self,
        video_id: str,
        status: Optional[str] = None,
        caption_status: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> None:
        """
        Update video processing status.

        Args:
            video_id: Video UUID
            status: Overall video status (uploading, processing, active, error)
            caption_status: Caption processing status (processing, ready, error)
            error_message: Error message if status is 'error'
        """
        ...

    def update_video_metadata(
        self,
        video_id: str,
        frame_count: Optional[int] = None,
        duration_seconds: Optional[float] = None,
        cropped_frames_version: Optional[int] = None
    ) -> None:
        """
        Update video metadata after processing.

        Args:
            video_id: Video UUID
            frame_count: Total frames extracted from video
            duration_seconds: Video duration
            cropped_frames_version: Version of cropped frames
        """
        ...

    # Server lock management (for blocking operations)
    def acquire_server_lock(
        self,
        video_id: str,
        database_name: str,
        lock_holder_user_id: Optional[str] = None,
        timeout_seconds: int = 300
    ) -> bool:
        """
        Acquire server lock on video database.
        Prevents concurrent modifications during processing.

        Behavior:
            - **Non-blocking**: Returns immediately without waiting
            - Returns True if lock was successfully acquired
            - Returns False if lock is already held by another holder
            - Does not wait or retry - caller decides retry strategy

        Args:
            video_id: Video UUID
            database_name: Database name (e.g., 'layout', 'captions')
            lock_holder_user_id: User ID acquiring lock (None for system locks)
            timeout_seconds: Currently unused, reserved for future blocking behavior

        Returns:
            True if lock acquired successfully
            False if lock already held by another holder

        Lock Granularity:
            - Per-database granularity (can lock 'layout' independently of 'captions')
            - System locks (user_id=None) and user locks are handled identically
            - No distinction between lock types - purpose is implicit in operation

        Usage Example:
            ```python
            # Attempt to acquire lock
            if not acquire_server_lock(video_id, "layout"):
                raise Exception("Video is currently being processed")

            try:
                # Process video - lock is held
                process_video()
            finally:
                # Always release in finally block
                release_server_lock(video_id, "layout")
            ```

        Retry Strategy:
            If lock acquisition fails, caller should:
            1. Abort operation immediately (fail-fast), OR
            2. Implement own retry logic with backoff, OR
            3. Queue operation for later (via Prefect retry mechanism)
        """
        ...

    def release_server_lock(
        self,
        video_id: str,
        database_name: str
    ) -> None:
        """
        Release server lock on video database.

        Args:
            video_id: Video UUID
            database_name: Database name (e.g., 'layout', 'captions')
        """
        ...


    # Tenant information
    def get_tenant_tier(self, tenant_id: str) -> str:
        """
        Get tenant subscription tier for priority calculation.

        Args:
            tenant_id: Tenant UUID

        Returns:
            Tier name (free, premium, enterprise)
        """
        ...

    def get_video_metadata(self, video_id: str) -> dict:
        """
        Get video metadata for processing.

        Args:
            video_id: Video UUID

        Returns:
            Dictionary with keys: tenant_id, storage_key, file_size_bytes,
            created_at, status, caption_status, etc.
        """
        ...


# Concrete implementation
class SupabaseServiceImpl:
    """
    Concrete implementation of SupabaseService.
    Adapted from /services/orchestrator/supabase_client.py
    """

    def __init__(self, supabase_url: str, supabase_key: str, schema: str = "captionacc_production"):
        """
        Initialize Supabase client.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
            schema: PostgreSQL schema name (default: captionacc_production)
        """
        from supabase import create_client

        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.schema = schema
        self.client = create_client(supabase_url, supabase_key)

    def update_video_status(
        self,
        video_id: str,
        status: Optional[str] = None,
        caption_status: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> None:
        """
        Update video processing status.

        Args:
            video_id: Video UUID
            status: Overall video status (uploading, processing, active, error)
            caption_status: Caption processing status (processing, ready, error)
            error_message: Error message if status is 'error'

        Note:
            The videos table does not have a separate caption_status column.
            This parameter is reserved for future use and currently ignored.
        """
        data = {}

        if status is not None:
            data["status"] = status

        # Note: caption_status and error_message are not in the current schema
        # They are included in the Protocol for future compatibility
        # For now, we'll use a JSONB metadata field if needed in the future

        if data:  # Only update if we have data to set
            self.client.schema(self.schema).table("videos").update(data).eq(
                "id", video_id
            ).execute()

    def update_video_metadata(
        self,
        video_id: str,
        frame_count: Optional[int] = None,
        duration_seconds: Optional[float] = None,
        cropped_frames_version: Optional[int] = None
    ) -> None:
        """
        Update video metadata after processing.

        Args:
            video_id: Video UUID
            frame_count: Total frames extracted from video (not stored in videos table)
            duration_seconds: Video duration
            cropped_frames_version: Version of cropped frames

        Note:
            frame_count is stored in cropped_frames_versions.total_frames, not in videos table.
            This implementation only updates duration_seconds and current_cropped_frames_version.
        """
        data = {}

        if duration_seconds is not None:
            data["duration_seconds"] = duration_seconds

        if cropped_frames_version is not None:
            data["current_cropped_frames_version"] = cropped_frames_version

        # Note: frame_count is not stored directly in the videos table
        # It's stored in cropped_frames_versions.total_frames instead

        if data:  # Only update if we have data to set
            self.client.schema(self.schema).table("videos").update(data).eq(
                "id", video_id
            ).execute()

    def acquire_server_lock(
        self,
        video_id: str,
        database_name: str,
        lock_holder_user_id: Optional[str] = None,
        timeout_seconds: int = 300
    ) -> bool:
        """
        Acquire server lock on video database.

        Behavior:
            - Non-blocking: Returns immediately without waiting
            - Returns True if lock was successfully acquired
            - Returns False if lock is already held by another holder
            - Does not wait or retry - caller decides retry strategy

        Args:
            video_id: Video UUID
            database_name: Database name (e.g., 'layout', 'captions')
            lock_holder_user_id: User ID acquiring lock (None for system locks)
            timeout_seconds: Currently unused, reserved for future blocking behavior

        Returns:
            True if lock acquired successfully
            False if lock already held by another holder

        Note:
            Requires video_database_state record to exist.
            If the record doesn't exist, this will fail.
            The record is typically created during video processing initialization.
        """
        from datetime import datetime, timezone

        # First, check if a lock already exists for this video+database
        response = (
            self.client.schema(self.schema)
            .table("video_database_state")
            .select("lock_holder_user_id, lock_type, tenant_id")
            .eq("video_id", video_id)
            .eq("database_name", database_name)
            .maybe_single()
            .execute()
        )

        state = response.data if response.data else None

        # If state doesn't exist, we need to get tenant_id from videos table
        if not state:
            # Get tenant_id from videos table
            video_response = (
                self.client.schema(self.schema)
                .table("videos")
                .select("tenant_id")
                .eq("id", video_id)
                .maybe_single()
                .execute()
            )

            if not video_response.data:
                # Video doesn't exist, can't acquire lock
                return False

            tenant_id = video_response.data.get("tenant_id")

            # Create the state record with the lock already acquired
            now = datetime.now(timezone.utc).isoformat()
            try:
                self.client.schema(self.schema).table("video_database_state").insert({
                    "video_id": video_id,
                    "database_name": database_name,
                    "tenant_id": tenant_id,
                    "server_version": 0,
                    "wasabi_version": 0,
                    "wasabi_synced_at": now,
                    "lock_holder_user_id": lock_holder_user_id,
                    "lock_type": "server",
                    "locked_at": now,
                    "last_activity_at": now,
                }).execute()
                return True
            except Exception:
                # Insert failed (possibly race condition), lock not acquired
                return False

        # If state exists and has a lock, check if it's held by someone else
        existing_lock_holder = state.get("lock_holder_user_id")
        existing_lock_type = state.get("lock_type")

        # If there's already a lock, we can't acquire it
        if existing_lock_holder is not None and existing_lock_type is not None:
            return False

        # Try to acquire the lock
        now = datetime.now(timezone.utc).isoformat()
        lock_data = {
            "lock_holder_user_id": lock_holder_user_id,
            "lock_type": "server",
            "locked_at": now,
            "last_activity_at": now,
        }

        try:
            # Update the lock fields
            self.client.schema(self.schema).table("video_database_state").update(
                lock_data
            ).eq("video_id", video_id).eq("database_name", database_name).execute()

            return True
        except Exception:
            # If update fails (e.g., race condition), lock was not acquired
            return False

    def release_server_lock(
        self,
        video_id: str,
        database_name: str
    ) -> None:
        """
        Release server lock on video database.

        Args:
            video_id: Video UUID
            database_name: Database name (e.g., 'layout', 'captions')
        """
        self.client.schema(self.schema).table("video_database_state").update({
            "lock_holder_user_id": None,
            "lock_type": None,
            "locked_at": None,
        }).eq("video_id", video_id).eq("database_name", database_name).execute()

    def get_tenant_tier(self, tenant_id: str) -> str:
        """
        Get tenant subscription tier for priority calculation.

        Args:
            tenant_id: Tenant UUID

        Returns:
            Tier name (free, premium, enterprise)

        Note:
            Maps access_tier_id to priority tier names:
            - 'demo' -> 'free'
            - 'trial' -> 'free'
            - 'active' -> 'premium'
        """
        # Query tenant to get a user from this tenant, then get their access tier
        # Alternative: We could add access_tier_id directly to tenants table
        # For now, we'll use a user from the tenant as a proxy

        response = (
            self.client.schema(self.schema)
            .table("user_profiles")
            .select("access_tier_id")
            .eq("tenant_id", tenant_id)
            .limit(1)
            .maybe_single()
            .execute()
        )

        if not response.data:
            # Default to free if no users found
            return "free"

        access_tier_id = response.data.get("access_tier_id", "demo")

        # Map access_tier_id to priority tier names
        tier_mapping = {
            "demo": "free",
            "trial": "free",
            "active": "premium",
        }

        return tier_mapping.get(access_tier_id, "free")

    def get_video_metadata(self, video_id: str) -> dict:
        """
        Get video metadata for processing.

        Args:
            video_id: Video UUID

        Returns:
            Dictionary with keys: tenant_id, storage_key, size_bytes,
            uploaded_at, status, etc.
        """
        response = (
            self.client.schema(self.schema)
            .table("videos")
            .select("*")
            .eq("id", video_id)
            .single()
            .execute()
        )

        if not response.data:
            return {}

        # Rename fields to match Protocol expectations
        video = response.data
        return {
            "tenant_id": video.get("tenant_id"),
            "storage_key": video.get("storage_key"),
            "file_size_bytes": video.get("size_bytes"),
            "created_at": video.get("uploaded_at"),
            "status": video.get("status"),
            "duration_seconds": video.get("duration_seconds"),
            "current_cropped_frames_version": video.get("current_cropped_frames_version"),
            "captions_db_key": video.get("captions_db_key"),
            "prefect_flow_run_id": video.get("prefect_flow_run_id"),
        }
