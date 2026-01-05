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
from typing import Any, cast

from supabase import Client, create_client


def get_supabase_client() -> Client:
    """
    Create a Supabase client using service role credentials.

    The orchestrator uses service role credentials to bypass RLS
    for system-level operations like updating video processing status.

    Returns:
        Supabase client instance

    Raises:
        ValueError: If required environment variables are not set
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment")

    return create_client(url, key)


class VideoRepository:
    """Repository for video operations in Supabase"""

    def __init__(self, client: Client | None = None):
        self.client = client or get_supabase_client()

    def create_video(
        self,
        tenant_id: str,
        filename: str,
        storage_key: str,
        size_bytes: int | None = None,
        duration_seconds: float | None = None,
        uploaded_by_user_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a new video entry in the catalog.

        Args:
            tenant_id: Tenant UUID
            filename: Original filename
            storage_key: Wasabi storage key (e.g., wasabi://videos/{tenant_id}/{video_id}/video.mp4)
            size_bytes: File size in bytes
            duration_seconds: Video duration
            uploaded_by_user_id: User UUID who uploaded the video

        Returns:
            Created video record
        """
        data = {
            "tenant_id": tenant_id,
            "filename": filename,
            "storage_key": storage_key,
            "size_bytes": size_bytes,
            "duration_seconds": duration_seconds,
            "uploaded_by_user_id": uploaded_by_user_id,
            "status": "uploading",
        }

        response = self.client.table("videos").insert(data).execute()
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

        response = self.client.table("videos").update(data).eq("id", video_id).execute()
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def update_annotations_db_key(self, video_id: str, annotations_db_key: str) -> dict[str, Any]:
        """
        Update the Wasabi storage key for the annotations database.

        Args:
            video_id: Video UUID
            annotations_db_key: Wasabi storage key for annotations.db

        Returns:
            Updated video record
        """
        response = (
            self.client.table("videos")
            .update({"annotations_db_key": annotations_db_key})
            .eq("id", video_id)
            .execute()
        )
        return response.data[0] if response.data else {}  # type: ignore[return-value]

    def get_video(self, video_id: str) -> dict[str, Any] | None:
        """Get video by ID"""
        response = self.client.table("videos").select("*").eq("id", video_id).single().execute()
        return response.data if response.data else None  # type: ignore[return-value]

    def get_tenant_videos(
        self, tenant_id: str, include_deleted: bool = False
    ) -> list[dict[str, Any]]:
        """Get all videos for a tenant"""
        query = self.client.table("videos").select("*").eq("tenant_id", tenant_id)

        if not include_deleted:
            query = query.is_("deleted_at", "null")

        response = query.execute()
        return response.data if response.data else []  # type: ignore[return-value]

    def lock_video(self, video_id: str, user_id: str) -> dict[str, Any]:
        """Lock a video for editing by a specific user"""
        response = (
            self.client.table("videos")
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
            self.client.table("videos")
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
            self.client.table("videos")
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

        response = self.client.table("video_search_index").upsert(data).execute()
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
            self.client.table("video_search_index")
            .select("*")
            .text_search("search_vector", query)
            .limit(limit)  # type: ignore[return-value]
            .execute()
        )
        return response.data if response.data else []


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

        response = self.client.table("training_cohorts").insert(data).execute()
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

        response = self.client.table("training_cohorts").update(data).eq("id", cohort_id).execute()
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

        response = self.client.table("cohort_videos").insert(data).execute()
        return response.data[0] if response.data else {}  # type: ignore[return-value]
