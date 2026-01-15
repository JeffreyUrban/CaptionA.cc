"""Request models for API endpoints."""

from pydantic import BaseModel


class AnnotationCreate(BaseModel):
    """Request body for creating an annotation."""

    frame_start: int
    frame_end: int
    text: str
    speaker: str | None = None


class AnnotationUpdate(BaseModel):
    """Request body for updating an annotation."""

    frame_start: int | None = None
    frame_end: int | None = None
    text: str | None = None
    speaker: str | None = None


class AnnotationBatchUpdate(BaseModel):
    """Request body for batch updating annotations."""

    annotations: list[AnnotationUpdate]


class FullFramesRequest(BaseModel):
    """Request body for triggering full frame extraction."""

    force: bool = False  # Re-extract even if frames exist


class CropFramesRequest(BaseModel):
    """Request body for triggering crop frame extraction + inference."""

    boxes: list[list[int]]  # [[x1, y1, x2, y2], ...] - efficient format


class InferenceRequest(BaseModel):
    """Request body for triggering inference on existing crop frames."""

    model: str = "default"  # Future: allow model selection


class ExportRequest(BaseModel):
    """Request body for triggering video export."""

    format: str = "mp4"
    quality: str = "high"  # low, medium, high
