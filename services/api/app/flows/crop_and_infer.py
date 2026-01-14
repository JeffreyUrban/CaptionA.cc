"""
Crop and Infer Caption Frame Extents Flow

Orchestrates the cropping and caption frame extents inference workflow:
1. Acquires server lock on 'layout' database (non-blocking)
2. Calls Modal to crop frames and run inference
3. Calls API endpoint to process inference results into captions.db
4. Updates video metadata with cropped frames version
5. Updates video caption_status to 'ready'
6. Releases server lock (in finally block)

This flow blocks users from editing the video during processing.
"""

from typing import Any

from prefect import flow, task
from prefect.artifacts import create_table_artifact

from ..config import get_settings
from ..services.supabase_service import SupabaseServiceImpl
from extract_crop_frames_and_infer_extents.models import CropRegion


@task(
    name="acquire-server-lock",
    tags=["lock", "supabase"],
    log_prints=True,
)
def acquire_server_lock(video_id: str, database_name: str) -> None:
    """
    Acquire server lock on video database.

    This is a non-blocking operation - returns immediately.
    Raises exception if lock cannot be acquired.

    Args:
        video_id: Video UUID
        database_name: Database name (e.g., 'layout', 'captions')

    Raises:
        Exception: If lock is already held by another process
    """
    print(f"[Lock] Attempting to acquire lock on {database_name} database for video {video_id}")

    settings = get_settings()
    supabase = SupabaseServiceImpl(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
    )

    success = supabase.acquire_server_lock(
        video_id=video_id,
        database_name=database_name,
        lock_holder_user_id=None,  # System lock (not user-initiated)
    )

    if not success:
        raise Exception(
            f"Video is currently being processed. "
            f"Lock on '{database_name}' database could not be acquired for video {video_id}."
        )

    print(f"[Lock] Successfully acquired lock on {database_name} database")


@task(
    name="release-server-lock",
    tags=["lock", "supabase"],
    log_prints=True,
)
def release_server_lock(video_id: str, database_name: str) -> None:
    """
    Release server lock on video database.

    Args:
        video_id: Video UUID
        database_name: Database name (e.g., 'layout', 'captions')
    """
    print(f"[Lock] Releasing lock on {database_name} database for video {video_id}")

    settings = get_settings()
    supabase = SupabaseServiceImpl(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
    )

    supabase.release_server_lock(
        video_id=video_id,
        database_name=database_name,
    )

    print(f"[Lock] Successfully released lock on {database_name} database")


@task(
    name="call-modal-crop-and-infer",
    retries=0,  # No retries - expensive GPU operation
    tags=["modal", "gpu", "inference"],
    log_prints=True,
)
async def call_modal_crop_and_infer(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0,
) -> dict[str, Any]:
    """
    Call Modal function to crop frames and run caption frame extents inference.

    Args:
        video_key: Wasabi S3 key for video file
        tenant_id: Tenant UUID
        video_id: Video UUID
        crop_region: CropRegion object with normalized coordinates
        frame_rate: Frame extraction rate in Hz (default 10.0)

    Returns:
        Dict with keys:
            - version: Cropped frames version number
            - frame_count: Number of frames processed
            - caption_frame_extents_db_key: Wasabi key for inference results DB
            - cropped_frames_prefix: Wasabi prefix for cropped frames
            - label_counts: Dict of inference label counts
            - processing_duration_seconds: Processing time
    """
    print(f"[Modal] Calling crop_and_infer_caption_frame_extents function")
    print(f"[Modal] Video key: {video_key}")
    print(f"[Modal] Crop region: {crop_region}")
    print(f"[Modal] Frame rate: {frame_rate}Hz")

    import modal

    # Lookup the deployed Modal function
    crop_infer_fn = modal.Function.from_name(
        "extract-crop-frames-and-infer-extents",
        "crop_and_infer_caption_frame_extents"
    )

    # Call the Modal function remotely
    result = await crop_infer_fn.remote.aio(
        video_key=video_key,
        tenant_id=tenant_id,
        video_id=video_id,
        crop_region=crop_region,
        frame_rate=frame_rate,
    )

    print(f"[Modal] Function completed successfully")
    print(f"[Modal] Version: v{result.version}")
    print(f"[Modal] Frames processed: {result.frame_count}")
    print(f"[Modal] Label counts: {result.label_counts}")
    print(f"[Modal] Processing time: {result.processing_duration_seconds:.2f}s")

    return {
        "version": result.version,
        "frame_count": result.frame_count,
        "caption_frame_extents_db_key": result.caption_frame_extents_db_key,
        "cropped_frames_prefix": result.cropped_frames_prefix,
        "label_counts": result.label_counts,
        "processing_duration_seconds": result.processing_duration_seconds,
    }


@task(
    name="process-inference-results",
    retries=2,  # Retry API calls
    retry_delay_seconds=10,
    tags=["api", "processing"],
    log_prints=True,
)
def process_inference_results(
    video_id: str,
    caption_frame_extents_db_key: str,
    cropped_frames_version: int,
) -> None:
    """
    Call API endpoint to process caption_frame_extents.db into captions.db.

    This step processes raw inference results into user-facing caption records.

    Args:
        video_id: Video UUID
        caption_frame_extents_db_key: Wasabi key for inference results DB
        cropped_frames_version: Version of cropped frames used
    """
    print(f"[API] Processing inference results into captions.db")
    print(f"[API] Inference DB key: {caption_frame_extents_db_key}")
    print(f"[API] Cropped frames version: v{cropped_frames_version}")

    # TODO: Call API endpoint to process caption_frame_extents.db into captions.db
    # This step processes raw inference results into user-facing caption records
    # For now, we'll note this as a placeholder

    print("[API] TODO: Implement API endpoint to process inference results")
    print("[API] Endpoint should:")
    print("  1. Download caption_frame_extents.db from Wasabi")
    print("  2. Parse inference results")
    print("  3. Create caption records in captions.db")
    print("  4. Upload captions.db.gz to Wasabi")


@task(
    name="update-video-metadata",
    retries=2,
    retry_delay_seconds=5,
    tags=["supabase", "metadata"],
    log_prints=True,
)
def update_video_metadata(
    video_id: str,
    cropped_frames_version: int,
) -> None:
    """
    Update video metadata with cropped frames version.

    Args:
        video_id: Video UUID
        cropped_frames_version: Version of cropped frames
    """
    print(f"[Supabase] Updating video metadata for video {video_id}")
    print(f"[Supabase] Setting cropped frames version: v{cropped_frames_version}")

    settings = get_settings()
    supabase = SupabaseServiceImpl(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
    )

    supabase.update_video_metadata(
        video_id=video_id,
        cropped_frames_version=cropped_frames_version,
    )

    print(f"[Supabase] Video metadata updated successfully")


@task(
    name="update-caption-status",
    retries=2,
    retry_delay_seconds=5,
    tags=["supabase", "status"],
    log_prints=True,
)
def update_caption_status(video_id: str, status: str) -> None:
    """
    Update video caption_status.

    Args:
        video_id: Video UUID
        status: Caption status ('processing', 'ready', 'error')
    """
    print(f"[Supabase] Updating caption status for video {video_id}: {status}")

    settings = get_settings()
    supabase = SupabaseServiceImpl(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
    )

    supabase.update_video_status(
        video_id=video_id,
        caption_status=status,
    )

    print(f"[Supabase] Caption status updated successfully")


@flow(
    name="captionacc-crop-and-infer-caption-frame-extents",
    log_prints=True,
    retries=0,  # No automatic retries for the entire flow
)
async def crop_and_infer(
    video_id: str,
    tenant_id: str,
    crop_region: dict
) -> dict[str, Any]:
    """
    Crops frames, runs inference, creates captions.db.

    Acquires server lock to block user editing during processing.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        crop_region: Dict with crop region coordinates (will convert to CropRegion)
                     Keys: crop_left, crop_top, crop_right, crop_bottom

    Returns:
        Dict with video_id and cropped_frames_version

    Raises:
        Exception: If lock cannot be acquired or processing fails
    """
    print(f"Starting crop and infer flow for video {video_id}")
    print(f"Tenant ID: {tenant_id}")

    # Convert crop_region dict to CropRegion dataclass
    crop_region_obj = CropRegion(**crop_region)

    # Build video key for Modal
    video_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

    # Step 1: Acquire server lock (non-blocking)
    print("\nStep 1/6: Acquiring server lock on 'layout' database...")
    acquire_server_lock(video_id, "layout")

    try:
        # Step 2: Update caption status to 'processing'
        print("\nStep 2/6: Updating caption status to 'processing'...")
        update_caption_status(video_id, "processing")

        # Step 3: Call Modal crop_and_infer_caption_frame_extents function
        print("\nStep 3/6: Calling Modal crop and infer function...")
        modal_result = await call_modal_crop_and_infer(
            video_key=video_key,
            tenant_id=tenant_id,
            video_id=video_id,
            crop_region=crop_region_obj,
            frame_rate=10.0,
        )

        # Step 4: Call API endpoint to process inference results into captions.db
        print("\nStep 4/6: Processing inference results into captions.db...")
        process_inference_results(
            video_id=video_id,
            caption_frame_extents_db_key=modal_result["caption_frame_extents_db_key"],
            cropped_frames_version=modal_result["version"],
        )

        # Step 5: Update video metadata with cropped frames version
        print("\nStep 5/6: Updating video metadata...")
        update_video_metadata(
            video_id=video_id,
            cropped_frames_version=modal_result["version"],
        )

        # Step 6: Update video caption_status to 'ready'
        print("\nStep 6/6: Updating caption status to 'ready'...")
        update_caption_status(video_id, "ready")

        # Create Prefect artifact for visibility
        create_table_artifact(
            key=f"crop-and-infer-{video_id}",
            table={
                "Video ID": [video_id],
                "Tenant ID": [tenant_id],
                "Version": [f"v{modal_result['version']}"],
                "Frame Count": [modal_result["frame_count"]],
                "Processing Time": [f"{modal_result['processing_duration_seconds']:.2f}s"],
                "Status": ["Ready"],
            },
            description=f"Crop and infer results for video {video_id}",
        )

        print(f"\nFlow completed successfully!")
        print(f"Video ID: {video_id}")
        print(f"Cropped frames version: v{modal_result['version']}")
        print(f"Frame count: {modal_result['frame_count']}")

        return {
            "video_id": video_id,
            "cropped_frames_version": modal_result["version"],
            "frame_count": modal_result["frame_count"],
            "status": "completed",
        }

    except Exception as e:
        # Update video status to 'error' on failure
        print(f"\nFlow failed with error: {e}")
        print("Updating caption status to 'error'...")

        try:
            update_caption_status(video_id, "error")
        except Exception as status_error:
            print(f"Failed to update caption status: {status_error}")

        # Re-raise the original exception
        raise

    finally:
        # Step 7: ALWAYS release server lock
        print("\nStep 7/7: Releasing server lock...")
        try:
            release_server_lock(video_id, "layout")
        except Exception as lock_error:
            print(f"Failed to release lock: {lock_error}")
            # Log but don't raise - we don't want to mask the original exception
