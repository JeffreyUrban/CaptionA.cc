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


# Concrete implementation placeholder
class SupabaseServiceImpl:
    """
    Concrete implementation of SupabaseService.
    To be extracted from /services/orchestrator/supabase_client.py
    """

    def __init__(self, supabase_url: str, supabase_key: str):
        """
        Initialize Supabase client.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
        """
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        # TODO: Initialize Supabase client

    # Implement all methods from SupabaseService protocol
    # Extract implementation from orchestrator service
