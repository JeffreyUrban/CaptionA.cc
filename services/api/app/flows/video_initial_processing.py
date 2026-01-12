"""
Prefect flow for initial video processing: frame extraction and OCR.

Triggered by: Supabase database webhook on `videos` table INSERT
Duration: 2-10 minutes (depending on video length)

This flow:
1. Updates video status to 'processing' in Supabase
2. Calls Modal extract_frames_and_ocr function remotely
3. Updates video metadata with processing results
4. Updates video status to 'active'

Modal function outputs (uploaded to Wasabi S3):
- {tenant_id}/client/videos/{video_id}/full_frames/*.jpg
- {tenant_id}/server/videos/{video_id}/raw-ocr.db.gz
- {tenant_id}/client/videos/{video_id}/layout.db.gz
"""

import logging
import os
from typing import Any

from prefect import flow, task

logger = logging.getLogger(__name__)


@task(name="update-video-status", retries=2)
def update_video_status_task(
    video_id: str, status: str, error_message: str | None = None
) -> None:
    """Update video status in Supabase."""
    from app.services.supabase_service import SupabaseServiceImpl

    supabase = SupabaseServiceImpl(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        schema=os.environ.get("SUPABASE_SCHEMA", "captionacc_production"),
    )

    logger.info(f"Updating video {video_id} status to '{status}'")
    supabase.update_video_status(
        video_id=video_id, status=status, error_message=error_message
    )


@task(name="extract-frames-and-ocr", timeout_seconds=1800, retries=0)
def extract_frames_and_ocr_task(
    video_key: str, tenant_id: str, video_id: str, frame_rate: float = 0.1
) -> dict[str, Any]:
    """Call Modal extract_frames_and_ocr function remotely."""
    import modal

    logger.info(
        f"Starting frame extraction for video {video_id} at {frame_rate} fps"
    )

    # Look up the Modal app and function
    modal_app = modal.App.lookup("captionacc")
    extract_fn = modal_app.function("extract_frames_and_ocr")

    # Call the Modal function remotely
    try:
        result = extract_fn.remote(
            video_key=video_key,
            tenant_id=tenant_id,
            video_id=video_id,
            frame_rate=frame_rate,
        )
    except Exception as e:
        logger.error(f"Modal function failed: {e}")
        raise RuntimeError(f"Frame extraction failed: {str(e)}") from e

    logger.info(
        f"Frame extraction complete: {result.frame_count} frames, "
        f"{result.duration:.1f}s duration, "
        f"{result.ocr_box_count} OCR boxes detected"
    )

    return {
        "frame_count": result.frame_count,
        "duration": result.duration,
        "frame_width": result.frame_width,
        "frame_height": result.frame_height,
        "video_codec": result.video_codec,
        "bitrate": result.bitrate,
        "ocr_box_count": result.ocr_box_count,
        "failed_ocr_count": result.failed_ocr_count,
        "processing_duration_seconds": result.processing_duration_seconds,
        "full_frames_key": result.full_frames_key,
        "ocr_db_key": result.ocr_db_key,
        "layout_db_key": result.layout_db_key,
    }


@task(name="update-video-metadata", retries=2)
def update_video_metadata_task(
    video_id: str, frame_count: int, duration: float
) -> None:
    """Update video metadata in Supabase after successful processing."""
    from app.services.supabase_service import SupabaseServiceImpl

    supabase = SupabaseServiceImpl(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        schema=os.environ.get("SUPABASE_SCHEMA", "captionacc_production"),
    )

    logger.info(
        f"Updating video {video_id} metadata: "
        f"{frame_count} frames, {duration:.1f}s duration"
    )
    supabase.update_video_metadata(
        video_id=video_id, duration_seconds=duration
    )


@flow(name="captionacc-video-initial-processing", log_prints=True)
async def video_initial_processing(
    video_id: str,
    tenant_id: str,
    storage_key: str,
) -> dict[str, Any]:
    """
    Extracts frames from uploaded video, runs OCR, and initializes layout.db.

    This flow is triggered by a Supabase webhook when a new video is uploaded.
    It performs the initial processing required before the user can annotate
    caption regions.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID for path scoping
        storage_key: Wasabi S3 key for the uploaded video file
                    Example: "tenant-123/client/videos/video-456/video.mp4"

    Returns:
        Dictionary containing:
        - video_id: Video UUID
        - frame_count: Number of frames extracted
        - duration: Video duration in seconds

    Raises:
        RuntimeError: If Modal function fails (timeout, processing errors)
        Exception: If status update fails

    State transitions:
        videos.status: 'uploading' -> 'processing' -> 'active'
                                                   -> 'error' (on failure)
    """
    logger.info(
        f"Starting video initial processing for video {video_id} "
        f"(tenant: {tenant_id}, storage_key: {storage_key})"
    )

    # Step 1: Update status to 'processing'
    try:
        update_video_status_task(video_id=video_id, status="processing")
    except Exception as e:
        logger.error(f"Failed to update video status to 'processing': {e}")
        raise

    # Step 2: Call Modal for frame extraction and OCR
    try:
        result = extract_frames_and_ocr_task(
            video_key=storage_key,
            tenant_id=tenant_id,
            video_id=video_id,
            frame_rate=0.1,  # 1 frame per 10 seconds for initial processing
        )
    except Exception as e:
        # On failure, update status to 'error'
        logger.error(f"Frame extraction failed: {e}")
        try:
            update_video_status_task(
                video_id=video_id,
                status="error",
                error_message=f"Frame extraction failed: {str(e)}",
            )
        except Exception as status_error:
            logger.error(f"Failed to update error status: {status_error}")

        # Re-raise for Prefect retry mechanism
        raise

    # Step 3: Update video metadata with results
    try:
        update_video_metadata_task(
            video_id=video_id,
            frame_count=result["frame_count"],
            duration=result["duration"],
        )
    except Exception as e:
        logger.error(f"Failed to update video metadata: {e}")
        # Don't fail the entire flow if metadata update fails
        # Processing was successful, just log the error

    # Step 4: Update status to 'active'
    try:
        update_video_status_task(video_id=video_id, status="active")
    except Exception as e:
        logger.error(f"Failed to update video status to 'active': {e}")
        raise

    logger.info(
        f"Video initial processing complete for {video_id}: "
        f"{result['frame_count']} frames, {result['duration']:.1f}s"
    )

    return {
        "video_id": video_id,
        "frame_count": result["frame_count"],
        "duration": result["duration"],
    }
