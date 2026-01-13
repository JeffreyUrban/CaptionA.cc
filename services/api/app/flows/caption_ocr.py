"""
Caption OCR Flow

Orchestrates caption OCR generation from median frames.

Flow: captionacc-caption-ocr
Trigger: API call when user confirms caption frame extents
Duration: 10-30 seconds

Steps:
1. Update caption status to 'processing'
2. Call Modal generate_caption_ocr function
3. Update caption with OCR result
4. Update caption status to 'completed'
5. Handle errors by updating status to 'error'
"""
import os
from typing import Any

import modal
from prefect import flow, get_run_logger

from app.services.caption_service import CaptionServiceImpl
from app.services.wasabi_service import WasabiServiceImpl


def _initialize_services() -> tuple[WasabiServiceImpl, CaptionServiceImpl]:
    """
    Initialize services from environment variables.

    Returns:
        Tuple of (wasabi_service, caption_service)
    """
    # Load environment variables
    wasabi_access_key = os.getenv("WASABI_ACCESS_KEY_ID") or os.getenv("WASABI_ACCESS_KEY_READWRITE")
    wasabi_secret_key = os.getenv("WASABI_SECRET_ACCESS_KEY") or os.getenv("WASABI_SECRET_KEY_READWRITE")
    wasabi_bucket = os.getenv("WASABI_BUCKET", "caption-acc-prod")
    wasabi_region = os.getenv("WASABI_REGION", "us-east-1")

    if not wasabi_access_key or not wasabi_secret_key:
        raise ValueError("Wasabi credentials not found in environment variables")

    # Initialize Wasabi service
    wasabi_service = WasabiServiceImpl(
        access_key=wasabi_access_key,
        secret_key=wasabi_secret_key,
        bucket=wasabi_bucket,
        region=wasabi_region
    )

    # Initialize Caption service (supabase_service=None for now)
    caption_service = CaptionServiceImpl(
        wasabi_service=wasabi_service,
        supabase_service=None
    )

    return wasabi_service, caption_service


@flow(
    name="captionacc-caption-ocr",
    log_prints=True,
    retries=1,
    retry_delay_seconds=30,
)
async def caption_ocr(
    tenant_id: str,
    video_id: str,
    caption_id: int,
    start_frame: int,
    end_frame: int,
    version: int
) -> dict[str, Any]:
    """
    Generates median frame from caption range and runs OCR.

    This flow:
    1. Updates caption status to 'processing'
    2. Calls Modal generate_caption_ocr function
    3. Updates caption with OCR result
    4. Updates caption status to 'completed'
    5. Handles errors by updating status to 'error'

    Args:
        tenant_id: Tenant UUID
        video_id: Video UUID
        caption_id: Caption record ID
        start_frame: Caption start frame index
        end_frame: Caption end frame index
        version: Cropped frames version to use

    Returns:
        Dict with caption_id, ocr_text, and confidence

    Raises:
        Exception: If Modal function fails or caption update fails
    """
    logger = get_run_logger()

    logger.info(f"Starting caption OCR flow for video {video_id}, caption {caption_id}")
    logger.info(f"Frame range: {start_frame} to {end_frame}, version: {version}")

    # Initialize services
    _, caption_service = _initialize_services()

    try:
        # Step 1: Update caption status to 'processing'
        logger.info(f"Updating caption {caption_id} status to 'processing'")
        caption_service.update_caption_status(
            video_id=video_id,
            tenant_id=tenant_id,
            caption_id=caption_id,
            status="processing"
        )

        # Step 2: Call Modal generate_caption_ocr function
        logger.info("Looking up Modal function")
        ocr_fn = modal.Function.from_name(
            "captionacc-processing",
            "generate_caption_ocr"
        )

        chunks_prefix = f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/"
        logger.info(f"Calling Modal generate_caption_ocr with chunks_prefix: {chunks_prefix}")

        result = await ocr_fn.remote.aio(
            chunks_prefix=chunks_prefix,
            start_frame=start_frame,
            end_frame=end_frame
        )

        logger.info(f"OCR completed. Text length: {len(result.ocr_text)}, confidence: {result.confidence}")

        # Step 3: Update caption with OCR result
        logger.info(f"Updating caption {caption_id} with OCR result")
        caption_service.update_caption_ocr(
            video_id=video_id,
            tenant_id=tenant_id,
            caption_id=caption_id,
            ocr_text=result.ocr_text,
            confidence=result.confidence
        )

        # Step 4: Update caption status to 'completed'
        logger.info(f"Updating caption {caption_id} status to 'completed'")
        caption_service.update_caption_status(
            video_id=video_id,
            tenant_id=tenant_id,
            caption_id=caption_id,
            status="completed"
        )

        logger.info(f"Caption OCR flow completed successfully for caption {caption_id}")

        return {
            "caption_id": caption_id,
            "ocr_text": result.ocr_text,
            "confidence": result.confidence
        }

    except Exception as e:
        # Step 5: Handle errors by updating status to 'error'
        error_message = str(e)
        logger.error(f"Caption OCR flow failed for caption {caption_id}: {error_message}")

        try:
            caption_service.update_caption_status(
                video_id=video_id,
                tenant_id=tenant_id,
                caption_id=caption_id,
                status="error",
                error_message=error_message
            )
            logger.info(f"Updated caption {caption_id} status to 'error'")
        except Exception as update_error:
            logger.error(f"Failed to update caption status to 'error': {update_error}")

        # Re-raise for Prefect retry mechanism
        raise
