"""Models for the consolidated /boxes endpoint."""

from pydantic import BaseModel

from app.models.layout import BoxLabel
from app.models.ocr import BoundingBox


class BoxAnnotation(BaseModel):
    """
    A box with OCR data merged with user/model labels.

    This is the primary data structure for the /boxes endpoint,
    combining OCR detection data with annotation status.
    """

    boxIndex: int
    text: str | None = None
    confidence: float | None = None
    bbox: BoundingBox | None = None
    userLabel: BoxLabel | None = None
    modelPrediction: BoxLabel | None = None

    @property
    def effectiveLabel(self) -> BoxLabel | None:
        """User label takes precedence over model prediction."""
        return self.userLabel if self.userLabel is not None else self.modelPrediction


class FrameBoxes(BaseModel):
    """All boxes for a single frame with merged annotations."""

    frameIndex: int
    boxes: list[BoxAnnotation]
    totalBoxes: int


# =============================================================================
# Request Models
# =============================================================================


class BoxAnnotationUpdate(BaseModel):
    """Single box annotation update."""

    boxIndex: int
    status: BoxLabel


class BoxAnnotationsUpdate(BaseModel):
    """Request body for updating box annotations."""

    annotations: list[BoxAnnotationUpdate]


# =============================================================================
# Response Models
# =============================================================================


class BoxesResponse(BaseModel):
    """Response for GET /boxes endpoint."""

    frame: FrameBoxes


class BoxesUpdateResponse(BaseModel):
    """Response for PUT /boxes endpoint."""

    updated: int
    frame: FrameBoxes
