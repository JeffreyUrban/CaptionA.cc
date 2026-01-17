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


@task(name="update-workflow-status", retries=2)
def update_workflow_status_task(
    video_id: str,
    layout_status: str | None = None,
    boundaries_status: str | None = None,
    text_status: str | None = None,
    layout_error_details: dict | None = None,
    boundaries_error_details: dict | None = None,
    text_error_details: dict | None = None,
) -> None:
    """Update video workflow status in Supabase."""
    from app.services.supabase_service import SupabaseServiceImpl

    supabase = SupabaseServiceImpl(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        schema=os.environ.get("SUPABASE_SCHEMA", "captionacc_production"),
    )

    status_updates = []
    if layout_status:
        status_updates.append(f"layout_status={layout_status}")
    if boundaries_status:
        status_updates.append(f"boundaries_status={boundaries_status}")
    if text_status:
        status_updates.append(f"text_status={text_status}")

    logger.info(f"Updating video {video_id} workflow status: {', '.join(status_updates)}")
    supabase.update_video_workflow_status(
        video_id=video_id,
        layout_status=layout_status,
        boundaries_status=boundaries_status,
        text_status=text_status,
        layout_error_details=layout_error_details,
        boundaries_error_details=boundaries_error_details,
        text_error_details=text_error_details,
    )


@task(name="extract-full-frames-and-ocr", timeout_seconds=1800, retries=0)
def extract_full_frames_and_ocr_task(
    video_key: str, tenant_id: str, video_id: str, frame_rate: float = 0.1
) -> dict[str, Any]:
    """Call Modal extract_full_frames_and_ocr function remotely."""
    import modal

    logger.info(f"Starting frame extraction for video {video_id} at {frame_rate} fps")

    # Look up the deployed Modal function
    extract_fn = modal.Function.from_name(
        "extract-full-frames-and-ocr", "extract_full_frames_and_ocr"
    )

    # Call the Modal function remotely
    try:
        result = extract_fn.remote(
            video_key=video_key,
            tenant_id=tenant_id,
            video_id=video_id,
            rate_hz=frame_rate,  # Parameter name is rate_hz in Modal function
        )
    except Exception as e:
        logger.error(f"Modal function failed: {e}")
        raise RuntimeError(f"Frame extraction failed: {str(e)}") from e

    logger.info(
        f"Frame extraction complete: {result['frame_count']} frames, "
        f"{result['duration']:.1f}s duration, "
        f"{result['ocr_box_count']} OCR boxes detected"
    )

    return {
        "frame_count": result["frame_count"],
        "duration": result["duration"],
        "frame_width": result["frame_width"],
        "frame_height": result["frame_height"],
        "video_codec": result["video_codec"],
        "bitrate": result["bitrate"],
        "ocr_box_count": result["ocr_box_count"],
        "failed_ocr_count": result["failed_ocr_count"],
        "processing_duration_seconds": result["processing_duration_seconds"],
        "full_frames_key": result["full_frames_key"],
        "ocr_db_key": result["ocr_db_key"],
        "layout_db_key": result["layout_db_key"],
    }


@task(name="update-video-metadata", retries=2)
def update_video_metadata_task(
    video_id: str, frame_count: int, duration: float, width: int, height: int
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
        f"{frame_count} frames, {duration:.1f}s duration, {width}x{height}"
    )

    # Update total_frames in videos table (for progress tracking)
    supabase.client.schema(supabase.schema).table("videos").update({
        "total_frames": frame_count,
        "duration_seconds": duration,
        "width": width,
        "height": height,
    }).eq("id", video_id).execute()


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
        videos.layout_status: 'wait' -> 'annotate' (on success)
                                     -> 'error' (on failure)

        Note: boundaries_status and text_status remain at default 'wait'
        until layout annotation is complete
    """
    logger.info(
        f"Starting video initial processing for video {video_id} "
        f"(tenant: {tenant_id}, storage_key: {storage_key})"
    )

    # Step 1: Call Modal for frame extraction and OCR
    # (Video starts with all statuses at 'wait' from database defaults)
    try:
        result = extract_full_frames_and_ocr_task(
            video_key=storage_key,
            tenant_id=tenant_id,
            video_id=video_id,
            frame_rate=0.1,  # 1 frame per 10 seconds for initial processing
        )
    except Exception as e:
        # On failure, update layout_status to 'error'
        logger.error(f"Frame extraction failed: {e}")
        try:
            update_workflow_status_task(
                video_id=video_id,
                layout_status="error",
                layout_error_details={
                    "message": f"Frame extraction failed: {str(e)}",
                    "error": str(e),
                },
            )
        except Exception as status_error:
            logger.error(f"Failed to update error status: {status_error}")

        # Re-raise for Prefect retry mechanism
        raise

    # Step 2: Update video metadata with results
    try:
        update_video_metadata_task(
            video_id=video_id,
            frame_count=result["frame_count"],
            duration=result["duration"],
            width=result["frame_width"],
            height=result["frame_height"],
        )
    except Exception as e:
        logger.error(f"Failed to update video metadata: {e}")
        # Don't fail the entire flow if metadata update fails
        # Processing was successful, just log the error

    # Step 3: Update layout_status to 'annotate' - ready for user to define layout
    try:
        update_workflow_status_task(video_id=video_id, layout_status="annotate")
    except Exception as e:
        logger.error(f"Failed to update workflow status to 'annotate': {e}")
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
