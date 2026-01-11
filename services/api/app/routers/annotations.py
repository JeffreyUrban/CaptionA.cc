"""Annotation-related endpoints: CRUD for caption annotations."""

from fastapi import APIRouter

from app.dependencies import Auth
from app.models.requests import AnnotationBatchUpdate, AnnotationCreate, AnnotationUpdate
from app.models.responses import AnnotationListResponse, AnnotationResponse

router = APIRouter()


@router.get("/{video_id}/annotations", response_model=AnnotationListResponse)
async def get_annotations(video_id: str, auth: Auth):
    """Get all annotations for a video."""
    # TODO: Implement
    raise NotImplementedError


@router.post("/{video_id}/annotations", response_model=AnnotationResponse)
async def create_annotation(video_id: str, body: AnnotationCreate, auth: Auth):
    """Create a new annotation."""
    # TODO: Implement
    raise NotImplementedError


@router.put("/{video_id}/annotations/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    video_id: str, annotation_id: str, body: AnnotationUpdate, auth: Auth
):
    """Update an existing annotation."""
    # TODO: Implement
    raise NotImplementedError


@router.delete("/{video_id}/annotations/{annotation_id}")
async def delete_annotation(video_id: str, annotation_id: str, auth: Auth):
    """Delete an annotation."""
    # TODO: Implement
    raise NotImplementedError


@router.post("/{video_id}/annotations/batch", response_model=AnnotationListResponse)
async def batch_update_annotations(video_id: str, body: AnnotationBatchUpdate, auth: Auth):
    """Batch update multiple annotations."""
    # TODO: Implement
    raise NotImplementedError
