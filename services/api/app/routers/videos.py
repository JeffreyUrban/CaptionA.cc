"""Video-related endpoints: layout, preferences, stats, image URLs."""

from fastapi import APIRouter

from app.dependencies import Auth
from app.models.responses import ImageUrlsResponse, LayoutResponse, PreferencesResponse, StatsResponse

router = APIRouter()


@router.get("/{video_id}/layout", response_model=LayoutResponse)
async def get_layout(video_id: str, auth: Auth):
    """Get layout config and analysis boxes for a video."""
    # TODO: Implement
    raise NotImplementedError


@router.put("/{video_id}/layout", response_model=LayoutResponse)
async def update_layout(video_id: str, auth: Auth):
    """Update layout config (crop bounds, selection, params)."""
    # TODO: Implement
    raise NotImplementedError


@router.get("/{video_id}/preferences", response_model=PreferencesResponse)
async def get_preferences(video_id: str, auth: Auth):
    """Get video preferences (text_size, padding_scale, text_anchor)."""
    # TODO: Implement
    raise NotImplementedError


@router.put("/{video_id}/preferences", response_model=PreferencesResponse)
async def update_preferences(video_id: str, auth: Auth):
    """Update video preferences."""
    # TODO: Implement
    raise NotImplementedError


@router.get("/{video_id}/stats", response_model=StatsResponse)
async def get_stats(video_id: str, auth: Auth):
    """Get video stats and progress."""
    # TODO: Implement
    raise NotImplementedError


@router.get("/{video_id}/image-urls", response_model=ImageUrlsResponse)
async def get_image_urls(video_id: str, frames: str, auth: Auth):
    """
    Get presigned URLs for frame images.

    Args:
        frames: Comma-separated frame indices (e.g., "0,10,20")
    """
    # TODO: Implement
    raise NotImplementedError
