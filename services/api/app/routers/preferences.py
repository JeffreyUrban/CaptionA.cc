"""Video preferences endpoint."""

from fastapi import APIRouter, HTTPException, status

from app.dependencies import Auth
from app.models.layout import VideoPreferencesResponse, VideoPreferencesUpdate
from app.repositories.layout import LayoutRepository
from app.services.database_manager import get_layout_database_manager

router = APIRouter()


@router.get("/{video_id}/preferences", response_model=VideoPreferencesResponse)
async def get_preferences(video_id: str, auth: Auth):
    """
    Get video preferences.

    Returns layout approval status and other video-specific preferences.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            preferences = repo.get_preferences()
            return VideoPreferencesResponse(preferences=preferences)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preferences not found for video {video_id}",
        )


@router.put("/{video_id}/preferences", response_model=VideoPreferencesResponse)
async def update_preferences(video_id: str, body: VideoPreferencesUpdate, auth: Auth):
    """
    Update video preferences.

    Set layoutApproved=true when the user confirms the layout is correct.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(
            auth.tenant_id, video_id, writable=True
        ) as conn:
            repo = LayoutRepository(conn)
            preferences = repo.update_preferences(body)
            return VideoPreferencesResponse(preferences=preferences)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preferences not found for video {video_id}",
        )
