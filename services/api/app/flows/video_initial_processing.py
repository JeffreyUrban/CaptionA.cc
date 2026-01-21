"""
Prefect flow for initial video processing: frame extraction, OCR, and layout analysis.

Triggered by: process_new_videos flow (via Realtime subscription or cron recovery)
Duration: 2-10 minutes (depending on video length)

This flow:
1. Calls Modal extract_frames_and_ocr function remotely
2. Analyzes OCR boxes to populate layout_config (crop, anchor, vertical_center)
3. Updates video metadata with processing results
4. Updates video status to 'annotate'

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
        schema=os.environ.get("SUPABASE_SCHEMA", "captionacc_prod"),
    )

    status_updates = []
    if layout_status:
        status_updates.append(f"layout_status={layout_status}")
    if boundaries_status:
        status_updates.append(f"boundaries_status={boundaries_status}")
    if text_status:
        status_updates.append(f"text_status={text_status}")

    logger.info(
        f"Updating video {video_id} workflow status: {', '.join(status_updates)}"
    )
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

    from app.config import get_settings

    settings = get_settings()
    logger.info(f"Starting frame extraction for video {video_id} at {frame_rate} fps")

    # Look up the deployed Modal function
    modal_app_name = (
        f"captionacc-extract-full-frames-and-ocr-{settings.modal_app_suffix}"
    )
    logger.info(f"Looking up Modal function: {modal_app_name}")
    extract_fn = modal.Function.from_name(modal_app_name, "extract_full_frames_and_ocr")

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


@task(name="analyze-layout-config", timeout_seconds=300, retries=2)
def analyze_layout_config_task(
    layout_db_key: str, frame_width: int, frame_height: int
) -> None:
    """Analyze OCR boxes and populate layout_config table.

    Downloads layout.db from Wasabi, analyzes the boxes to determine
    crop region, anchor type/position, and vertical center, then
    updates the layout_config table and re-uploads.

    All layout_config values are normalized to 0-1 range.
    """
    import gzip
    import sqlite3
    import tempfile
    from collections import Counter
    from statistics import mode, stdev

    import boto3

    # Get S3 client
    wasabi_client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{os.environ['WASABI_REGION']}.wasabisys.com",
        aws_access_key_id=os.environ["WASABI_ACCESS_KEY_READWRITE"],
        aws_secret_access_key=os.environ["WASABI_SECRET_KEY_READWRITE"],
        region_name=os.environ["WASABI_REGION"],
    )
    bucket_name = os.environ["WASABI_BUCKET"]

    with tempfile.TemporaryDirectory() as tmpdir:
        # Download and decompress layout.db.gz
        gz_path = f"{tmpdir}/layout.db.gz"
        db_path = f"{tmpdir}/layout.db"

        logger.info(f"Downloading {layout_db_key}")
        wasabi_client.download_file(bucket_name, layout_db_key, gz_path)

        with gzip.open(gz_path, "rb") as f_in:
            with open(db_path, "wb") as f_out:
                f_out.write(f_in.read())

        # Connect and load boxes
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Load all boxes (fractional coordinates, y from bottom)
        rows = cursor.execute(
            "SELECT bbox_left, bbox_top, bbox_right, bbox_bottom FROM boxes"
        ).fetchall()

        if not rows:
            logger.warning("No boxes found in layout.db, skipping layout analysis")
            conn.close()
            return

        logger.info(f"Analyzing {len(rows)} boxes for layout config")

        # Convert fractional coords to pixel coords for analysis
        # boxes table: bbox_top/bottom are y measured from bottom (fractional 0-1)
        pixel_boxes = []
        for bbox_left, bbox_top, bbox_right, bbox_bottom in rows:
            # Convert from bottom-referenced fractional to top-referenced pixels
            left = int(bbox_left * frame_width)
            right = int(bbox_right * frame_width)
            # bbox_bottom is y from bottom, bbox_top is y+height from bottom
            bottom = int((1 - bbox_bottom) * frame_height)  # Convert to top-referenced
            top = int((1 - bbox_top) * frame_height)
            pixel_boxes.append([left, top, right, bottom])

        # Calculate crop bounds (bounding box of all text + margin)
        margin = 10
        all_lefts = [box[0] for box in pixel_boxes]
        all_tops = [box[1] for box in pixel_boxes]
        all_rights = [box[2] for box in pixel_boxes]
        all_bottoms = [box[3] for box in pixel_boxes]

        crop_left_px = max(0, min(all_lefts) - margin)
        crop_right_px = min(frame_width, max(all_rights) + margin)
        crop_top_px = max(0, min(all_tops) - margin)
        crop_bottom_px = min(frame_height, max(all_bottoms) + margin)

        # Find typical boxes (mode top/bottom positions)
        try:
            top_mode = mode(all_tops)
            bottom_mode = mode(all_bottoms)
            tolerance = 5
            typical_boxes = [
                box
                for box in pixel_boxes
                if abs(box[1] - top_mode) <= tolerance
                and abs(box[3] - bottom_mode) <= tolerance
            ]
            if not typical_boxes:
                typical_boxes = pixel_boxes
        except Exception:
            typical_boxes = pixel_boxes

        # Determine anchor type
        left_edges = [box[0] for box in typical_boxes]
        right_edges = [box[2] for box in typical_boxes]
        centers = [(box[0] + box[2]) / 2 for box in typical_boxes]

        left_std = stdev(left_edges) if len(left_edges) > 1 else float("inf")
        right_std = stdev(right_edges) if len(right_edges) > 1 else float("inf")
        center_std = stdev(centers) if len(centers) > 1 else float("inf")

        min_std = min(left_std, right_std, center_std)
        if min_std == left_std:
            anchor_type = "left"
            # Mode of left edges
            bin_size = 5
            binned = [round(e / bin_size) * bin_size for e in left_edges]
            anchor_position_px = Counter(binned).most_common(1)[0][0]
        elif min_std == right_std:
            anchor_type = "right"
            bin_size = 5
            binned = [round(e / bin_size) * bin_size for e in right_edges]
            anchor_position_px = Counter(binned).most_common(1)[0][0]
        else:
            anchor_type = "center"
            anchor_position_px = sum(centers) / len(centers)

        # Calculate vertical center (mode of box vertical centers)
        vertical_positions = [(box[1] + box[3]) // 2 for box in typical_boxes]
        vertical_center_px = mode(vertical_positions)

        # Normalize all values to 0-1
        crop_left = crop_left_px / frame_width
        crop_right = crop_right_px / frame_width
        crop_top = crop_top_px / frame_height
        crop_bottom = crop_bottom_px / frame_height
        anchor_position = anchor_position_px / frame_width
        vertical_center = vertical_center_px / frame_height

        logger.info(
            f"Layout analysis results: crop=({crop_left:.3f}, {crop_top:.3f}, {crop_right:.3f}, {crop_bottom:.3f}), "
            f"anchor={anchor_type}@{anchor_position:.3f}, vertical_center={vertical_center:.3f}"
        )

        # Update layout_config table
        cursor.execute(
            """
            UPDATE layout_config SET
                crop_left = ?,
                crop_top = ?,
                crop_right = ?,
                crop_bottom = ?,
                anchor_type = ?,
                anchor_position = ?,
                vertical_center = ?,
                updated_at = datetime('now')
            WHERE id = 1
            """,
            (
                crop_left,
                crop_top,
                crop_right,
                crop_bottom,
                anchor_type,
                anchor_position,
                vertical_center,
            ),
        )
        conn.commit()
        conn.close()

        # Compress and re-upload
        with open(db_path, "rb") as f_in:
            with gzip.open(gz_path, "wb") as f_out:
                f_out.write(f_in.read())

        logger.info(f"Uploading updated {layout_db_key}")
        wasabi_client.upload_file(gz_path, bucket_name, layout_db_key)


@task(name="update-video-metadata", retries=2)
def update_video_metadata_task(
    video_id: str, frame_count: int, duration: float, width: int, height: int
) -> None:
    """Update video metadata in Supabase after successful processing."""
    from app.services.supabase_service import SupabaseServiceImpl

    supabase = SupabaseServiceImpl(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        schema=os.environ.get("SUPABASE_SCHEMA", "captionacc_prod"),
    )

    logger.info(
        f"Updating video {video_id} metadata: "
        f"{frame_count} frames, {duration:.1f}s duration, {width}x{height}"
    )

    # Update total_frames in videos table (for progress tracking)
    supabase.client.schema(supabase.schema).table("videos").update(
        {
            "total_frames": frame_count,
            "duration_seconds": duration,
            "width": width,
            "height": height,
        }
    ).eq("id", video_id).execute()


@flow(name="captionacc-video-initial-processing", log_prints=True)
async def video_initial_processing(
    video_id: str,
    tenant_id: str,
    storage_key: str,
) -> dict[str, Any]:
    """
    Extracts frames from uploaded video, runs OCR, and initializes layout.db.

    This flow is triggered by the process_new_videos flow when a video is uploaded.
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

    # Step 2: Analyze boxes and populate layout_config
    try:
        analyze_layout_config_task(
            layout_db_key=result["layout_db_key"],
            frame_width=result["frame_width"],
            frame_height=result["frame_height"],
        )
    except Exception as e:
        logger.error(f"Layout analysis failed: {e}")
        try:
            update_workflow_status_task(
                video_id=video_id,
                layout_status="error",
                layout_error_details={
                    "message": f"Layout analysis failed: {str(e)}",
                    "error": str(e),
                },
            )
        except Exception as status_error:
            logger.error(f"Failed to update error status: {status_error}")
        raise

    # Step 3: Update video metadata with results
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

    # Step 4: Update layout_status to 'annotate' - ready for user to define layout
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
