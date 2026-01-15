"""Video stats endpoint."""

from fastapi import APIRouter

from app.dependencies import Auth
from app.models.stats import StatsResponse, VideoStats
from app.repositories.captions import CaptionRepository
from app.repositories.ocr import OcrRepository
from app.services.database_manager import (
    get_database_manager,
    get_ocr_database_manager,
)

router = APIRouter()


@router.get("/{video_id}/stats", response_model=StatsResponse)
async def get_stats(video_id: str, auth: Auth):
    """
    Get video statistics and progress.

    Returns frame counts, annotation progress, and processing status.
    """
    caption_db_manager = get_database_manager()
    ocr_db_manager = get_ocr_database_manager()

    total_frames = 0
    covered_frames = 0
    annotation_count = 0
    needs_text_count = 0
    processing_status = "unknown"

    # Get OCR stats for total frames
    try:
        async with ocr_db_manager.get_database(auth.tenant_id, video_id) as ocr_conn:
            ocr_repo = OcrRepository(ocr_conn)
            ocr_stats = ocr_repo.get_stats()
            total_frames = ocr_stats["frames_with_ocr"]
            processing_status = "ready" if total_frames > 0 else "pending"
    except FileNotFoundError:
        processing_status = "pending"

    # Get caption stats
    try:
        async with caption_db_manager.get_database(auth.tenant_id, video_id) as caption_conn:
            caption_repo = CaptionRepository(caption_conn)
            # Get all captions to calculate stats
            captions = caption_repo.list_captions(0, 999999999)
            annotation_count = len(captions)

            # Calculate covered frames (non-gap captions)
            for caption in captions:
                if caption.captionFrameExtentsState.value != "gap":
                    covered_frames += caption.endFrameIndex - caption.startFrameIndex + 1

                # Count captions needing text
                if caption.textPending or (
                    caption.text is None and caption.captionFrameExtentsState.value != "gap"
                ):
                    needs_text_count += 1

    except FileNotFoundError:
        # No captions database yet
        pass

    # Calculate progress
    progress_percent = 0.0
    if total_frames > 0:
        progress_percent = round((covered_frames / total_frames) * 100, 1)

    return StatsResponse(
        stats=VideoStats(
            totalFrames=total_frames,
            coveredFrames=covered_frames,
            progressPercent=progress_percent,
            annotationCount=annotation_count,
            needsTextCount=needs_text_count,
            processingStatus=processing_status,
        )
    )
