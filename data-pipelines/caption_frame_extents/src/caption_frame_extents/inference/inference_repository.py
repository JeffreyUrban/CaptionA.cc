"""Supabase repository for caption frame extents inference run tracking.

Provides fast indexed lookups for completed inference runs and active job monitoring.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypedDict, cast

from rich.console import Console
from supabase import Client, create_client

console = Console(stderr=True)


class InferenceRunRow(TypedDict):
    """Supabase caption_frame_extents_inference_runs table row structure."""

    id: str
    run_id: str
    video_id: str
    tenant_id: str
    cropped_frames_version: int
    model_version: str
    model_checkpoint_path: str | None
    wasabi_storage_key: str
    file_size_bytes: int | None
    total_pairs: int
    processing_time_seconds: float | None
    started_at: str  # ISO format timestamp
    completed_at: str  # ISO format timestamp
    created_at: str  # ISO format timestamp


class InferenceJobRow(TypedDict):
    """Supabase caption_frame_extents_inference_jobs table row structure."""

    id: str
    run_id: str
    video_id: str
    tenant_id: str
    cropped_frames_version: int
    model_version: str
    priority: str
    status: str
    started_at: str | None  # ISO format timestamp
    completed_at: str | None  # ISO format timestamp
    error_message: str | None
    inference_run_id: str | None
    created_at: str  # ISO format timestamp


@dataclass
class InferenceRun:
    """Completed inference run record."""

    id: str
    run_id: str
    video_id: str
    tenant_id: str
    cropped_frames_version: int
    model_version: str
    model_checkpoint_path: str | None
    wasabi_storage_key: str
    file_size_bytes: int | None
    total_pairs: int
    processing_time_seconds: float | None
    started_at: datetime
    completed_at: datetime
    created_at: datetime

    @classmethod
    def from_dict(cls, data: InferenceRunRow) -> InferenceRun:
        """Create from Supabase row."""
        return cls(
            id=data["id"],
            run_id=data["run_id"],
            video_id=data["video_id"],
            tenant_id=data["tenant_id"],
            cropped_frames_version=data["cropped_frames_version"],
            model_version=data["model_version"],
            model_checkpoint_path=data.get("model_checkpoint_path"),
            wasabi_storage_key=data["wasabi_storage_key"],
            file_size_bytes=data.get("file_size_bytes"),
            total_pairs=data["total_pairs"],
            processing_time_seconds=data.get("processing_time_seconds"),
            started_at=datetime.fromisoformat(data["started_at"].replace("Z", "+00:00")),
            completed_at=datetime.fromisoformat(data["completed_at"].replace("Z", "+00:00")),
            created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
        )


@dataclass
class InferenceJob:
    """Active or historical inference job."""

    id: str
    video_id: str
    tenant_id: str
    cropped_frames_version: int
    model_version: str
    status: str  # queued, running, completed, failed
    priority: str  # high, low
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    inference_run_id: str | None
    created_at: datetime

    @classmethod
    def from_dict(cls, data: InferenceJobRow) -> InferenceJob:
        """Create from Supabase row."""
        return cls(
            id=data["id"],
            video_id=data["video_id"],
            tenant_id=data["tenant_id"],
            cropped_frames_version=data["cropped_frames_version"],
            model_version=data["model_version"],
            status=data["status"],
            priority=data["priority"],
            started_at=datetime.fromisoformat(data["started_at"].replace("Z", "+00:00"))
            if data["started_at"]
            else None,
            completed_at=datetime.fromisoformat(data["completed_at"].replace("Z", "+00:00"))
            if data["completed_at"]
            else None,
            error_message=data.get("error_message"),
            inference_run_id=data.get("inference_run_id"),
            created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
        )


class CaptionFrameExtentsInferenceRunRepository:
    """Repository for caption frame extents inference run tracking in Supabase.

    Fast indexed lookups for:
    - Duplicate detection: Does this run already exist?
    - Video queries: What runs exist for this video?
    - Model queries: What videos have been processed with this model?

    Usage:
        # Initialize with Supabase credentials
        repo = CaptionFrameExtentsInferenceRunRepository(supabase_url, supabase_key)

        # Check if run exists (fast lookup via unique index)
        existing = repo.get_existing_run(video_id, frames_version=1, model_version="abc123...")
        if existing:
            print(f"Run already exists: {existing.wasabi_storage_key}")

        # Register new run after inference completes
        run = repo.register_run(
            run_id="550e8400-e29b-41d4-a716-446655440000",
            video_id="video-uuid",
            tenant_id="tenant-uuid",
            cropped_frames_version=1,
            model_version="abc123...",
            wasabi_storage_key="videos/tenant/video/caption-frame-extents/v1_model-abc123_run-550e8400.db",
            file_size_bytes=52428800,
            total_pairs=25000,
            processing_time_seconds=120.5,
            started_at=datetime(2025, 1, 7, 10, 0, 0),
            completed_at=datetime(2025, 1, 7, 10, 2, 0),
            model_checkpoint_path="/models/fusion_lora.pt"
        )
    """

    def __init__(self, supabase_url: str, supabase_key: str):
        """Initialize repository with Supabase client.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key (for RLS bypass)
        """
        self.client: Client = create_client(supabase_url, supabase_key)

    def get_existing_run(
        self,
        video_id: str,
        cropped_frames_version: int,
        model_version: str,
    ) -> InferenceRun | None:
        """Get existing run for video + version + model combination.

        Fast lookup using unique index on (video_id, cropped_frames_version, model_version).

        Args:
            video_id: Video UUID
            cropped_frames_version: Frame version number
            model_version: Model checkpoint hash

        Returns:
            InferenceRun if exists, None otherwise
        """
        response = (
            self.client.table("caption_frame_extents_inference_runs")
            .select("*")
            .eq("video_id", video_id)
            .eq("cropped_frames_version", cropped_frames_version)
            .eq("model_version", model_version)
            .maybe_single()
            .execute()
        )

        if response and response.data:
            # Supabase maybe_single() returns a dict or None
            return InferenceRun.from_dict(cast(InferenceRunRow, response.data))
        return None

    def register_run(
        self,
        run_id: str,
        video_id: str,
        tenant_id: str,
        cropped_frames_version: int,
        model_version: str,
        wasabi_storage_key: str,
        total_pairs: int,
        started_at: datetime,
        completed_at: datetime,
        file_size_bytes: int | None = None,
        processing_time_seconds: float | None = None,
        model_checkpoint_path: str | None = None,
    ) -> InferenceRun:
        """Register completed inference run.

        Args:
            run_id: Inference run UUID
            video_id: Video UUID
            tenant_id: Tenant UUID
            cropped_frames_version: Frame version number
            model_version: Model checkpoint hash
            wasabi_storage_key: Full Wasabi path to Caption Frame Extents DB
            total_pairs: Number of frame pairs processed
            started_at: Run start time
            completed_at: Run completion time
            file_size_bytes: Size of DB file in bytes
            processing_time_seconds: Total processing time
            model_checkpoint_path: Path to model checkpoint used

        Returns:
            Created InferenceRun record

        Raises:
            Exception: If insert fails (e.g., duplicate run)
        """
        data = {
            "run_id": run_id,
            "video_id": video_id,
            "tenant_id": tenant_id,
            "cropped_frames_version": cropped_frames_version,
            "model_version": model_version,
            "wasabi_storage_key": wasabi_storage_key,
            "file_size_bytes": file_size_bytes,
            "total_pairs": total_pairs,
            "processing_time_seconds": processing_time_seconds,
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "model_checkpoint_path": model_checkpoint_path,
        }

        response = self.client.table("caption_frame_extents_inference_runs").insert(data).execute()

        if not response.data:
            raise ValueError("Failed to register inference run")

        # Supabase insert returns a list of dicts
        data_list = cast(list[InferenceRunRow], response.data)
        console.print(f"[green]✓ Registered inference run in Supabase: {run_id}[/green]")
        return InferenceRun.from_dict(data_list[0])

    def get_runs_for_video(
        self,
        video_id: str,
        limit: int | None = None,
    ) -> list[InferenceRun]:
        """Get all inference runs for a video.

        Fast lookup using index on video_id.

        Args:
            video_id: Video UUID
            limit: Maximum number of runs to return

        Returns:
            List of InferenceRuns ordered by completion time (most recent first)
        """
        query = (
            self.client.table("caption_frame_extents_inference_runs")
            .select("*")
            .eq("video_id", video_id)
            .order("completed_at", desc=True)
        )

        if limit:
            query = query.limit(limit)

        response = query.execute()
        return [InferenceRun.from_dict(row) for row in cast(list[InferenceRunRow], response.data)]

    def get_runs_for_model(
        self,
        model_version: str,
        limit: int | None = None,
    ) -> list[InferenceRun]:
        """Get all videos processed with specific model version.

        Fast lookup using index on model_version.

        Args:
            model_version: Model checkpoint hash
            limit: Maximum number of runs to return

        Returns:
            List of InferenceRuns ordered by completion time (most recent first)
        """
        query = (
            self.client.table("caption_frame_extents_inference_runs")
            .select("*")
            .eq("model_version", model_version)
            .order("completed_at", desc=True)
        )

        if limit:
            query = query.limit(limit)

        response = query.execute()
        return [InferenceRun.from_dict(row) for row in cast(list[InferenceRunRow], response.data)]

    def get_runs_for_tenant(
        self,
        tenant_id: str,
        limit: int | None = None,
    ) -> list[InferenceRun]:
        """Get all inference runs for a tenant.

        Fast lookup using index on tenant_id.

        Args:
            tenant_id: Tenant UUID
            limit: Maximum number of runs to return

        Returns:
            List of InferenceRuns ordered by completion time (most recent first)
        """
        query = (
            self.client.table("caption_frame_extents_inference_runs")
            .select("*")
            .eq("tenant_id", tenant_id)
            .order("completed_at", desc=True)
        )

        if limit:
            query = query.limit(limit)

        response = query.execute()
        return [InferenceRun.from_dict(row) for row in cast(list[InferenceRunRow], response.data)]

    # Job queue methods

    def create_job(
        self,
        video_id: str,
        tenant_id: str,
        cropped_frames_version: int,
        model_version: str,
        priority: str = "high",
    ) -> InferenceJob:
        """Create new inference job in queue.

        Args:
            video_id: Video UUID
            tenant_id: Tenant UUID
            cropped_frames_version: Frame version number
            model_version: Model checkpoint hash
            priority: Job priority (high or low)

        Returns:
            Created InferenceJob record
        """
        data = {
            "video_id": video_id,
            "tenant_id": tenant_id,
            "cropped_frames_version": cropped_frames_version,
            "model_version": model_version,
            "status": "queued",
            "priority": priority,
        }

        response = self.client.table("caption_frame_extents_inference_jobs").insert(data).execute()

        if not response.data:
            raise ValueError("Failed to create inference job")

        job_data = cast(list[InferenceJobRow], response.data)
        console.print(f"[cyan]Created inference job: {job_data[0]['id']}[/cyan]")
        return InferenceJob.from_dict(job_data[0])

    def update_job_status(
        self,
        job_id: str,
        status: str,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
        error_message: str | None = None,
        inference_run_id: str | None = None,
    ) -> InferenceJob:
        """Update job status.

        Args:
            job_id: Job UUID
            status: New status (queued, running, completed, failed)
            started_at: Job start time
            completed_at: Job completion time
            error_message: Error message if failed
            inference_run_id: Link to completed run if successful

        Returns:
            Updated InferenceJob record
        """
        data: dict[str, Any] = {"status": status}

        if started_at:
            data["started_at"] = started_at.isoformat()
        if completed_at:
            data["completed_at"] = completed_at.isoformat()
        if error_message:
            data["error_message"] = error_message
        if inference_run_id:
            data["inference_run_id"] = inference_run_id

        response = self.client.table("caption_frame_extents_inference_jobs").update(data).eq("id", job_id).execute()

        if not response.data:
            raise ValueError(f"Failed to update job {job_id}")

        return InferenceJob.from_dict(cast(list[InferenceJobRow], response.data)[0])

    def get_pending_jobs(self, limit: int = 10) -> list[InferenceJob]:
        """Get pending jobs ordered by priority and creation time.

        Fast lookup using index on (priority, status).

        Args:
            limit: Maximum number of jobs to return

        Returns:
            List of pending jobs (high priority first, then low priority)
        """
        # Get high priority jobs
        high_priority = (
            self.client.table("caption_frame_extents_inference_jobs")
            .select("*")
            .eq("status", "queued")
            .eq("priority", "high")
            .order("created_at")
            .limit(limit)
            .execute()
        )

        # Get low priority jobs if needed
        remaining = limit - len(high_priority.data)
        low_priority_data = []
        if remaining > 0:
            low_priority = (
                self.client.table("caption_frame_extents_inference_jobs")
                .select("*")
                .eq("status", "queued")
                .eq("priority", "low")
                .order("created_at")
                .limit(remaining)
                .execute()
            )
            low_priority_data = cast(list[InferenceJobRow], low_priority.data)

        all_jobs = cast(list[InferenceJobRow], high_priority.data) + low_priority_data
        return [InferenceJob.from_dict(row) for row in all_jobs]

    def get_jobs_for_video(self, video_id: str) -> list[InferenceJob]:
        """Get all jobs for a video.

        Args:
            video_id: Video UUID

        Returns:
            List of InferenceJobs ordered by creation time (most recent first)
        """
        response = (
            self.client.table("caption_frame_extents_inference_jobs")
            .select("*")
            .eq("video_id", video_id)
            .order("created_at", desc=True)
            .execute()
        )

        return [InferenceJob.from_dict(row) for row in cast(list[InferenceJobRow], response.data)]
