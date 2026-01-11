"""Models for action endpoints."""

from enum import Enum

from pydantic import BaseModel


class BulkAnnotateAction(str, Enum):
    """Action to perform on boxes."""

    MARK_IN = "mark_in"
    MARK_OUT = "mark_out"
    CLEAR = "clear"


class Rectangle(BaseModel):
    """Rectangle coordinates for bulk selection."""

    left: int
    top: int
    right: int
    bottom: int


class BulkAnnotateRequest(BaseModel):
    """Request body for bulk annotate endpoint."""

    rectangle: Rectangle
    action: BulkAnnotateAction
    frame: int | None = None
    allFrames: bool = False


class BulkAnnotateResponse(BaseModel):
    """Response for bulk annotate endpoint."""

    success: bool
    boxesModified: int
    framesAffected: int


class AnalyzeLayoutResponse(BaseModel):
    """Response for analyze layout endpoint."""

    success: bool
    boxesAnalyzed: int
    processingTimeMs: int


class CalculatePredictionsResponse(BaseModel):
    """Response for calculate predictions endpoint."""

    success: bool
    predictionsGenerated: int
    modelVersion: str


class ProcessingType(str, Enum):
    """Type of processing to trigger."""

    CROP_AND_INFER = "crop-and-infer"


class TriggerProcessingRequest(BaseModel):
    """Request body for trigger processing endpoint."""

    type: ProcessingType


class TriggerProcessingResponse(BaseModel):
    """Response for trigger processing endpoint."""

    success: bool
    jobId: str
    status: str


class RetryStep(str, Enum):
    """Processing step to retry."""

    FULL_FRAMES = "full-frames"
    OCR = "ocr"
    CROP = "crop"
    INFERENCE = "inference"


class RetryRequest(BaseModel):
    """Request body for retry endpoint."""

    step: RetryStep


class RetryResponse(BaseModel):
    """Response for retry endpoint."""

    success: bool
    jobId: str
    step: RetryStep
