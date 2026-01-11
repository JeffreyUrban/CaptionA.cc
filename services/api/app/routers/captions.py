"""Caption CRUD endpoints for caption boundary management."""

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import Auth
from app.models.captions import (
    Caption,
    CaptionCreate,
    CaptionListResponse,
    CaptionResponse,
    CaptionTextUpdate,
    CaptionUpdate,
    DeleteResponse,
    OverlapResolutionResponse,
)
from app.repositories.captions import CaptionRepository
from app.services.database_manager import get_database_manager

router = APIRouter()


@router.get("/{video_id}/captions", response_model=CaptionListResponse)
async def get_captions(
    video_id: str,
    auth: Auth,
    start: int = Query(..., description="Start frame index"),
    end: int = Query(..., description="End frame index"),
    workable: bool = Query(False, description="Only return gaps or pending captions"),
    limit: int | None = Query(None, description="Maximum number of captions"),
):
    """
    Get captions overlapping a frame range.

    Returns captions where their frame range overlaps [start, end].
    Use workable=true to filter to only gaps or pending captions.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            captions = repo.list_captions(start, end, workable, limit)
            return CaptionListResponse(captions=captions)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.get("/{video_id}/captions/{caption_id}", response_model=CaptionResponse)
async def get_caption(video_id: str, caption_id: int, auth: Auth):
    """Get a single caption by ID."""
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            caption = repo.get_caption(caption_id)
            if caption is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Caption {caption_id} not found",
                )
            return CaptionResponse(caption=caption)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.post("/{video_id}/captions", response_model=CaptionResponse, status_code=status.HTTP_201_CREATED)
async def create_caption(video_id: str, body: CaptionCreate, auth: Auth):
    """
    Create a new caption.

    Note: This does NOT perform overlap resolution. The client should
    use PUT to update an existing caption if overlap resolution is needed.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_or_create_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            caption = repo.create_caption(body)
            return CaptionResponse(caption=caption)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/{video_id}/captions/{caption_id}", response_model=OverlapResolutionResponse)
async def update_caption(
    video_id: str, caption_id: int, body: CaptionUpdate, auth: Auth
):
    """
    Update caption boundaries with automatic overlap resolution.

    This endpoint handles the complex overlap resolution logic:
    - Captions completely contained in the new range are deleted
    - Overlapping captions are trimmed or split
    - Gap captions are created for uncovered ranges when shrinking

    The response includes all affected captions for client-side state updates.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = CaptionRepository(conn)
            try:
                result = repo.update_caption_with_overlap_resolution(caption_id, body)
                return result
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.put("/{video_id}/captions/{caption_id}/text", response_model=CaptionResponse)
async def update_caption_text(
    video_id: str, caption_id: int, body: CaptionTextUpdate, auth: Auth
):
    """
    Update caption text content.

    Use this endpoint to set the caption text after boundary editing.
    Also accepts optional textStatus and textNotes fields.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = CaptionRepository(conn)
            caption = repo.update_caption_text(caption_id, body)
            if caption is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Caption {caption_id} not found",
                )
            return CaptionResponse(caption=caption)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.delete("/{video_id}/captions/{caption_id}", response_model=DeleteResponse)
async def delete_caption(video_id: str, caption_id: int, auth: Auth):
    """Delete a caption."""
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = CaptionRepository(conn)
            deleted = repo.delete_caption(caption_id)
            if not deleted:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Caption {caption_id} not found",
                )
            return DeleteResponse(deleted=True)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )
