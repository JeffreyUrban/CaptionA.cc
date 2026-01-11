"""OCR read endpoints for fullOCR.db."""

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import Auth
from app.models.ocr import (
    FrameOcrListResponse,
    FrameOcrResponse,
    OcrDetectionListResponse,
    OcrDetectionResponse,
    OcrStatsResponse,
)
from app.repositories.ocr import OcrRepository
from app.services.database_manager import get_ocr_database_manager

router = APIRouter()


@router.get("/{video_id}/ocr/detections", response_model=OcrDetectionListResponse)
async def list_ocr_detections(
    video_id: str,
    auth: Auth,
    frame: int | None = Query(None, description="Filter by frame index"),
    limit: int | None = Query(100, description="Maximum detections to return"),
    offset: int | None = Query(None, description="Number of detections to skip"),
):
    """
    List OCR detections with optional filtering.

    Use frame parameter to get detections for a specific frame.
    Supports pagination with limit and offset.
    """
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            detections = repo.list_detections(frame, limit, offset)
            total = repo.count_detections(frame)
            return OcrDetectionListResponse(detections=detections, total=total)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )


@router.get("/{video_id}/ocr/detections/{detection_id}", response_model=OcrDetectionResponse)
async def get_ocr_detection(video_id: str, detection_id: int, auth: Auth):
    """Get a single OCR detection by ID."""
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            detection = repo.get_detection(detection_id)
            if detection is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"OCR detection {detection_id} not found",
                )
            return OcrDetectionResponse(detection=detection)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )


@router.get("/{video_id}/ocr/frames/{frame_index}", response_model=FrameOcrResponse)
async def get_frame_ocr(video_id: str, frame_index: int, auth: Auth):
    """
    Get all OCR detections for a specific frame.

    Returns the frame's OCR results including all detected text boxes.
    """
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            frame = repo.get_frame_ocr(frame_index)
            if frame is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No OCR data for frame {frame_index}",
                )
            return FrameOcrResponse(frame=frame)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )


@router.get("/{video_id}/ocr/frames", response_model=FrameOcrListResponse)
async def list_frames_with_ocr(
    video_id: str,
    auth: Auth,
    start: int | None = Query(None, description="Start frame index"),
    end: int | None = Query(None, description="End frame index"),
    limit: int | None = Query(50, description="Maximum frames to return"),
):
    """
    List frames that have OCR detections.

    Use start and end to filter to a specific frame range.
    Returns OCR results grouped by frame.
    """
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            frames = repo.list_frames_with_ocr(start, end, limit)
            return FrameOcrListResponse(frames=frames, totalFrames=len(frames))
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )


@router.get("/{video_id}/ocr/range", response_model=OcrDetectionListResponse)
async def get_detections_in_range(
    video_id: str,
    auth: Auth,
    start: int = Query(..., description="Start frame index"),
    end: int = Query(..., description="End frame index"),
    limit: int | None = Query(None, description="Maximum detections to return"),
):
    """
    Get all OCR detections within a frame range.

    Useful for getting OCR data for a specific segment of the video.
    """
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            detections = repo.get_detections_in_range(start, end, limit)
            return OcrDetectionListResponse(detections=detections, total=len(detections))
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )


@router.get("/{video_id}/ocr/search", response_model=OcrDetectionListResponse)
async def search_ocr_text(
    video_id: str,
    auth: Auth,
    q: str = Query(..., description="Text to search for"),
    limit: int | None = Query(100, description="Maximum results to return"),
):
    """
    Search for OCR detections containing specific text.

    Performs a case-insensitive search across all detected text.
    """
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            detections = repo.search_text(q, limit)
            return OcrDetectionListResponse(detections=detections, total=len(detections))
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )


@router.get("/{video_id}/ocr/stats", response_model=OcrStatsResponse)
async def get_ocr_stats(video_id: str, auth: Auth):
    """
    Get OCR statistics for the video.

    Returns total detections, frames with OCR, and average detections per frame.
    """
    db_manager = get_ocr_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = OcrRepository(conn)
            stats = repo.get_stats()
            return OcrStatsResponse(
                totalDetections=stats["total_detections"],
                framesWithOcr=stats["frames_with_ocr"],
                avgDetectionsPerFrame=stats["avg_detections_per_frame"],
            )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )
