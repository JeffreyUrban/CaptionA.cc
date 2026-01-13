"""
Supabase Client for Orchestrator Service

Provides access to Supabase for:
- Video status updates during Prefect flow execution
- Video cataloging with tenant isolation
- Training cohort management
- Search index updates
"""

import os
from datetime import datetime
from typing import Any

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

# Local Supabase demo keys - Placeholder values for local development
# For actual local development, get keys from: https://supabase.com/docs/guides/cli/local-development
# These keys only work with `supabase start` on localhost:54321
# Production keys are NEVER in code - only in environment variables/secrets
LOCAL_SUPABASE_URL = "http://localhost:54321"
LOCAL_SUPABASE_SERVICE_ROLE_KEY = "LOCAL_DEVELOPMENT_SERVICE_ROLE_KEY_PLACEHOLDER"


def get_supabase_client(require_production: bool = False, schema: str | None = None) -> Client:
    """
    Create a Supabase client using service role credentials with schema support.

    The orchestrator uses service role credentials to bypass RLS
    for system-level operations like updating video processing status.

    Args:
        require_production: If True, raises error if using local Supabase.
                          Useful for production deployments to ensure
                          proper configuration.
        schema: PostgreSQL schema to use. If None, determined automatically:
                - Local: 'public' (default PostgreSQL schema)
                - Online: from SUPABASE_SCHEMA env var or 'captionacc_production'
                Options: 'public', 'captionacc_production', 'captionacc_staging'

    Returns:
        Supabase client instance configured for specified schema

    Raises:
        ValueError: If require_production=True and using local Supabase

    Environment Variables:
        SUPABASE_URL: Supabase instance URL (default: http://localhost:54321)
        SUPABASE_SERVICE_ROLE_KEY: Service role key (default: demo key)
        SUPABASE_SCHEMA: PostgreSQL schema name (default: auto-detected)
    """
    # Get from environment or use local defaults
    url = os.environ.get("SUPABASE_URL", LOCAL_SUPABASE_URL)
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", LOCAL_SUPABASE_SERVICE_ROLE_KEY)

    is_local = url == LOCAL_SUPABASE_URL

    # Determine schema if not explicitly provided
    if schema is None:
        if is_local:
            # Local Supabase uses public schema
            schema = "public"
        else:
            # Online Supabase uses named schemas
            schema = os.environ.get("SUPABASE_SCHEMA", "captionacc_production")

    # Safety check for production deployments
    if require_production and is_local:
        raise ValueError(
            "Production Supabase required but local configuration detected. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
        )

    # Log environment for debugging
    env_label = "LOCAL" if is_local else "ONLINE"
    print(f"🔌 Supabase: {env_label} ({url}) [schema: {schema}]")

    # Create client with schema in options
    options = SyncClientOptions(schema=schema)
    client = create_client(url, key, options=options)

    # Store schema preference for use in queries
    client._preferred_schema = schema  # type: ignore

    return client


class VideoRepository:
    """Repository for video operations in Supabase"""

    def __init__(self, client: Client | None = None):
        self.client = client or get_supabase_client()

    def create_video(
        self,
        tenant_id: str,
        storage_key: str,
        size_bytes: int | None = None,
        duration_seconds: float | None = None,
        uploaded_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a new video entry in the catalog.

        Args:
            tenant_id: Tenant UUID
            storage_key: Wasabi storage key (e.g., wasabi://videos/{tenant_id}/{video_id}/video.mp4)
            size_bytes: File size in bytes
            duration_seconds: Video duration
            uploaded_by_user_id: User UUID who uploaded the video

        Returns:
            Created video record
        """
        data = {
            "tenant_id": tenant_id,
            "storage_key": storage_key,
            "size_bytes": size_bytes,
            "duration_seconds": duration_seconds,
            "uploaded_by_user_id": uploaded_by_user_id,
            "status": "uploading",
        }

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .insert(data)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def update_video_status(
        self,
        video_id: str,
        status: str,
        prefect_flow_run_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Update video processing status.

        Args:
            video_id: Video UUID
            status: One of: uploading, processing, active, failed, archived, soft_deleted, purged
            prefect_flow_run_id: Prefect flow run UUID

        Returns:
            Updated video record
        """
        data = {"status": status}
        if prefect_flow_run_id:
            data["prefect_flow_run_id"] = prefect_flow_run_id

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .update(data)
            .eq("id", video_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def update_captions_db_key(self, video_id: str, captions_db_key: str) -> dict[str, Any]:
        """
        Update the Wasabi storage key for the annotations database.

        Args:
            video_id: Video UUID
            captions_db_key: Wasabi storage key for captions.db

        Returns:
            Updated video record
        """
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .update({"captions_db_key": captions_db_key})
            .eq("id", video_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def get_video(self, video_id: str) -> dict[str, Any] | None:
        """Get video by ID"""
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .select("*")
            .eq("id", video_id)
            .single()
            .execute()
        )
        return response.data if response.data else None  # type: ignore[return-value]

    def get_tenant_videos(
        self, tenant_id: str, include_deleted: bool = False
    ) -> list[dict[str, Any]]:
        """Get all videos for a tenant"""
        query = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .select("*")
            .eq("tenant_id", tenant_id)
        )

        if not include_deleted:
            query = query.is_("deleted_at", "null")

        response = query.execute()
        return response.data if response.data else []  # type: ignore[return-value]

    def lock_video(self, video_id: str, user_id: str) -> dict[str, Any]:
        """Lock a video for editing by a specific user"""
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .update(
                {
                    "locked_by_user_id": user_id,
                    "locked_at": datetime.utcnow().isoformat(),
                }
            )
            .eq("id", video_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def unlock_video(self, video_id: str) -> dict[str, Any]:
        """Unlock a video"""
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .update(
                {
                    "locked_by_user_id": None,
                    "locked_at": None,
                }
            )
            .eq("id", video_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def soft_delete_video(self, video_id: str) -> dict[str, Any]:
        """Soft delete a video"""
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .update(
                {
                    "status": "soft_deleted",
                    "deleted_at": datetime.utcnow().isoformat(),
                }
            )
            .eq("id", video_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]


class SearchIndexRepository:
    """Repository for video search index operations"""

    def __init__(self, client: Client | None = None):
        self.client = client or get_supabase_client()

    def upsert_frame_text(
        self,
        video_id: str,
        frame_index: int,
        ocr_text: str | None = None,
        caption_text: str | None = None,
    ) -> dict[str, Any]:
        """
        Upsert text for a video frame into the search index.

        Args:
            video_id: Video UUID
            frame_index: Frame index
            ocr_text: OCR extracted text
            caption_text: Caption text from annotations

        Returns:
            Upserted search index record
        """
        data = {
            "video_id": video_id,
            "frame_index": frame_index,
            "ocr_text": ocr_text,
            "caption_text": caption_text,
            "updated_at": datetime.utcnow().isoformat(),
        }

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("video_search_index")
            .upsert(data)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def search_text(
        self, query: str, tenant_id: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        """
        Full-text search across video frames.

        Args:
            query: Search query
            tenant_id: Optional tenant ID to filter results
            limit: Max number of results

        Returns:
            List of matching search index records
        """
        # Note: This uses the search_vector generated column
        # Full-text search query format: 'word1 & word2' or 'word1 | word2'
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("video_search_index")
            .select("*")
            .text_search("search_vector", query)
            .limit(limit)  # type: ignore[return-value]
            .execute()
        )
        return response.data if response.data else []


class CroppedFramesVersionRepository:
    """Repository for cropped frames version operations"""

    def __init__(self, client: Client | None = None):
        self.client = client or get_supabase_client()

    def get_next_version(self, video_id: str) -> int:
        """
        Get the next version number for a video's cropped frames.

        Args:
            video_id: Video UUID

        Returns:
            Next version number (1 for first version)
        """
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .rpc("get_next_cropped_frames_version", {"p_video_id": video_id})
            .execute()
        )
        return response.data if response.data else 1  # type: ignore[return-value]

    def create_version(
        self,
        video_id: str,
        tenant_id: str,
        version: int,
        storage_prefix: str,
        crop_bounds: dict[str, int],
        frame_rate: float = 10.0,
        layout_db_storage_key: str | None = None,
        layout_db_hash: str | None = None,
        created_by_user_id: str | None = None,
        prefect_flow_run_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a new cropped frames version record.

        Args:
            video_id: Video UUID
            tenant_id: Tenant UUID
            version: Version number
            storage_prefix: Wasabi storage prefix for chunks
            crop_bounds: Crop bounds dict {left, top, right, bottom}
            frame_rate: Frame extraction rate in Hz
            layout_db_storage_key: Wasabi key for layout.db
            layout_db_hash: SHA-256 hash of layout.db
            created_by_user_id: User UUID who initiated
            prefect_flow_run_id: Prefect flow run UUID

        Returns:
            Created version record
        """
        data = {
            "video_id": video_id,
            "tenant_id": tenant_id,
            "version": version,
            "storage_prefix": storage_prefix,
            "crop_bounds": crop_bounds,
            "frame_rate": frame_rate,
            "layout_db_storage_key": layout_db_storage_key,
            "layout_db_hash": layout_db_hash,
            "created_by_user_id": created_by_user_id,
            "prefect_flow_run_id": prefect_flow_run_id,
            "status": "processing",
        }

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cropped_frames_versions")
            .insert(data)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def update_version_chunks(
        self,
        version_id: str,
        chunk_count: int,
        total_frames: int,
        total_size_bytes: int,
    ) -> dict[str, Any]:
        """
        Update chunk metadata for a version.

        Args:
            version_id: Version UUID
            chunk_count: Number of WebM chunks
            total_frames: Total frames across chunks
            total_size_bytes: Total size in bytes

        Returns:
            Updated version record
        """
        data = {
            "chunk_count": chunk_count,
            "total_frames": total_frames,
            "total_size_bytes": total_size_bytes,
        }

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cropped_frames_versions")
            .update(data)
            .eq("id", version_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def update_version_status(self, version_id: str, status: str) -> dict[str, Any]:
        """
        Update version status.

        Args:
            version_id: Version UUID
            status: One of: processing, active, archived, failed

        Returns:
            Updated version record
        """
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cropped_frames_versions")
            .update({"status": status})
            .eq("id", version_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def activate_version(self, version_id: str) -> None:
        """
        Activate a version (archives previous active version).

        Args:
            version_id: Version UUID to activate
        """
        self.client.schema(
            self.client._preferred_schema  # type: ignore[attr-defined]
        ).rpc("activate_cropped_frames_version", {"p_version_id": version_id}).execute()

    def get_active_version(self, video_id: str) -> dict[str, Any] | None:
        """
        Get the active cropped frames version for a video.

        Args:
            video_id: Video UUID

        Returns:
            Active version record or None
        """
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cropped_frames_versions")
            .select("*")
            .eq("video_id", video_id)
            .eq("status", "active")
            .execute()
        )
        return response.data[0] if response.data else None  # type: ignore[return-value]

    def get_version(self, version_id: str) -> dict[str, Any] | None:
        """
        Get a cropped frames version by ID.

        Args:
            version_id: Version UUID

        Returns:
            Version record or None
        """
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cropped_frames_versions")
            .select("*")
            .eq("id", version_id)
            .single()
            .execute()
        )
        return response.data if response.data else None  # type: ignore[return-value]

    def get_all_versions(self, video_id: str) -> list[dict[str, Any]]:
        """
        Get all cropped frames versions for a video (including archived).

        Args:
            video_id: Video UUID

        Returns:
            List of version records
        """
        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cropped_frames_versions")
            .select("*")
            .eq("video_id", video_id)
            .order("version", desc=True)
            .execute()
        )
        return response.data if response.data else []  # type: ignore[return-value]


class TrainingCohortRepository:
    """Repository for training cohort operations"""

    def __init__(self, client: Client | None = None):
        self.client = client or get_supabase_client()

    def create_cohort(
        self,
        cohort_id: str,
        language: str | None = None,
        domain: str | None = None,
        snapshot_storage_key: str | None = None,
    ) -> dict[str, Any]:
        """Create a new training cohort"""
        data = {
            "id": cohort_id,
            "language": language,
            "domain": domain,
            "snapshot_storage_key": snapshot_storage_key,
            "status": "building",
        }

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("training_cohorts")
            .insert(data)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def update_cohort_stats(
        self,
        cohort_id: str,
        total_videos: int | None = None,
        total_frames: int | None = None,
        total_annotations: int | None = None,
        wandb_run_id: str | None = None,
        git_commit: str | None = None,
    ) -> dict[str, Any]:
        """Update cohort statistics"""
        data = {}
        if total_videos is not None:
            data["total_videos"] = total_videos
        if total_frames is not None:
            data["total_frames"] = total_frames
        if total_annotations is not None:
            data["total_annotations"] = total_annotations
        if wandb_run_id:
            data["wandb_run_id"] = wandb_run_id
        if git_commit:
            data["git_commit"] = git_commit

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("training_cohorts")
            .update(data)
            .eq("id", cohort_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def add_video_to_cohort(
        self,
        cohort_id: str,
        video_id: str,
        tenant_id: str,
        frames_contributed: int,
        annotations_contributed: int,
    ) -> dict[str, Any]:
        """Add a video to a training cohort"""
        data = {
            "cohort_id": cohort_id,
            "video_id": video_id,
            "tenant_id": tenant_id,
            "frames_contributed": frames_contributed,
            "annotations_contributed": annotations_contributed,
        }

        response = (
            self.client.schema(self.client._preferred_schema)  # type: ignore[attr-defined]
            .table("cohort_videos")
            .insert(data)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]
