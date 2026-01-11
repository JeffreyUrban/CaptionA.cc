"""Video-related endpoints: image URLs."""

from fastapi import APIRouter

from app.dependencies import Auth
from app.models.responses import ImageUrlsResponse

router = APIRouter()


@router.get("/{video_id}/image-urls", response_model=ImageUrlsResponse)
async def get_image_urls(video_id: str, frames: str, auth: Auth):
    """
    Get presigned URLs for frame images.

    Args:
        frames: Comma-separated frame indices (e.g., "0,10,20")
    """
    # TODO: Implement
    raise NotImplementedError
