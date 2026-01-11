"""Caption models matching the captions table schema."""

from enum import Enum

from pydantic import BaseModel, Field


class BoundaryState(str, Enum):
    """Caption boundary state."""

    PREDICTED = "predicted"
    CONFIRMED = "confirmed"
    GAP = "gap"


class TextStatus(str, Enum):
    """Text status for caption review."""

    VALID_CAPTION = "valid_caption"
    OCR_ERROR = "ocr_error"
    PARTIAL_CAPTION = "partial_caption"
    TEXT_UNCLEAR = "text_unclear"
    OTHER_ISSUE = "other_issue"


class MedianOcrStatus(str, Enum):
    """Median OCR processing status."""

    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


# =============================================================================
# Database Row Model (matches SQLite schema exactly)
# =============================================================================


class CaptionRow(BaseModel):
    """Database row from the captions table (snake_case)."""

    id: int
    start_frame_index: int
    end_frame_index: int
    boundary_state: BoundaryState
    boundary_pending: int  # 0 or 1
    boundary_updated_at: str
    text: str | None = None
    text_pending: int  # 0 or 1
    text_status: str | None = None
    text_notes: str | None = None
    text_ocr_combined: str | None = None
    text_updated_at: str
    image_needs_regen: int  # 0 or 1
    median_ocr_status: str = "queued"
    median_ocr_error: str | None = None
    median_ocr_processed_at: str | None = None
    created_at: str


# =============================================================================
# API Models (camelCase for frontend)
# =============================================================================


class Caption(BaseModel):
    """Caption domain model for API responses (camelCase)."""

    id: int
    startFrameIndex: int
    endFrameIndex: int
    boundaryState: BoundaryState
    boundaryPending: bool
    boundaryUpdatedAt: str
    text: str | None = None
    textPending: bool
    textStatus: str | None = None
    textNotes: str | None = None
    textOcrCombined: str | None = None
    textUpdatedAt: str
    imageNeedsRegen: bool
    medianOcrStatus: str
    medianOcrError: str | None = None
    medianOcrProcessedAt: str | None = None
    createdAt: str

    @classmethod
    def from_row(cls, row: CaptionRow) -> "Caption":
        """Transform database row to API model."""
        return cls(
            id=row.id,
            startFrameIndex=row.start_frame_index,
            endFrameIndex=row.end_frame_index,
            boundaryState=row.boundary_state,
            boundaryPending=row.boundary_pending == 1,
            boundaryUpdatedAt=row.boundary_updated_at,
            text=row.text,
            textPending=row.text_pending == 1,
            textStatus=row.text_status,
            textNotes=row.text_notes,
            textOcrCombined=row.text_ocr_combined,
            textUpdatedAt=row.text_updated_at,
            imageNeedsRegen=row.image_needs_regen == 1,
            medianOcrStatus=row.median_ocr_status,
            medianOcrError=row.median_ocr_error,
            medianOcrProcessedAt=row.median_ocr_processed_at,
            createdAt=row.created_at,
        )


# =============================================================================
# Request Models
# =============================================================================


class CaptionCreate(BaseModel):
    """Request body for creating a caption."""

    startFrameIndex: int
    endFrameIndex: int
    boundaryState: BoundaryState = BoundaryState.PREDICTED
    boundaryPending: bool = False
    text: str | None = None


class CaptionUpdate(BaseModel):
    """Request body for updating caption boundaries (with overlap resolution)."""

    startFrameIndex: int
    endFrameIndex: int
    boundaryState: BoundaryState = BoundaryState.CONFIRMED


class CaptionTextUpdate(BaseModel):
    """Request body for updating caption text."""

    text: str
    textStatus: TextStatus | None = None
    textNotes: str | None = None


class CaptionBatchUpdate(BaseModel):
    """Request body for batch operations (legacy)."""

    updates: list[CaptionUpdate] = Field(default_factory=list)
    deletes: list[int] = Field(default_factory=list)


# =============================================================================
# Batch Operation Models
# =============================================================================


class BatchOperationType(str, Enum):
    """Type of batch operation."""

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class BatchCreateData(BaseModel):
    """Data for creating a caption in a batch."""

    startFrameIndex: int
    endFrameIndex: int
    boundaryState: BoundaryState = BoundaryState.PREDICTED
    text: str | None = None


class BatchUpdateData(BaseModel):
    """Data for updating a caption in a batch."""

    startFrameIndex: int | None = None
    endFrameIndex: int | None = None
    boundaryState: BoundaryState | None = None
    text: str | None = None
    textStatus: TextStatus | None = None
    textNotes: str | None = None


class BatchOperation(BaseModel):
    """A single operation in a batch request."""

    op: BatchOperationType
    id: int | None = None  # Required for update/delete
    data: BatchCreateData | BatchUpdateData | None = None  # Required for create/update


class BatchRequest(BaseModel):
    """Request body for batch caption operations."""

    operations: list[BatchOperation]


class BatchResultItem(BaseModel):
    """Result of a single batch operation."""

    op: BatchOperationType
    id: int


class BatchError(BaseModel):
    """Error details for a failed batch operation."""

    index: int
    op: BatchOperationType
    message: str


class BatchResponse(BaseModel):
    """Response for batch operations."""

    success: bool
    results: list[BatchResultItem] | None = None
    error: BatchError | None = None


# =============================================================================
# Response Models
# =============================================================================


class CaptionResponse(BaseModel):
    """Response for single caption operations."""

    caption: Caption


class CaptionListResponse(BaseModel):
    """Response for listing captions."""

    captions: list[Caption]


class OverlapResolutionResponse(BaseModel):
    """Response for operations with overlap resolution."""

    caption: Caption
    deletedCaptions: list[int] = Field(default_factory=list)
    modifiedCaptions: list[Caption] = Field(default_factory=list)
    createdGaps: list[Caption] = Field(default_factory=list)


class DeleteResponse(BaseModel):
    """Response for delete operations."""

    deleted: bool
