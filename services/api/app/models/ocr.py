"""OCR models for fullOCR.db API operations."""

from pydantic import BaseModel


# =============================================================================
# Database Row Models (matches SQLite schema - snake_case)
# =============================================================================


class FullFrameOcrRow(BaseModel):
    """Database row from full_frame_ocr table."""

    id: int
    frame_id: int
    frame_index: int
    box_index: int
    text: str | None = None
    confidence: float | None = None
    bbox_left: int | None = None
    bbox_top: int | None = None
    bbox_right: int | None = None
    bbox_bottom: int | None = None
    created_at: str


# =============================================================================
# API Models (camelCase for frontend)
# =============================================================================


class BoundingBox(BaseModel):
    """Bounding box coordinates."""

    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        """Calculate width from coordinates."""
        return self.right - self.left

    @property
    def height(self) -> int:
        """Calculate height from coordinates."""
        return self.bottom - self.top


class OcrDetection(BaseModel):
    """Single OCR detection for API responses."""

    id: int
    frameId: int
    frameIndex: int
    boxIndex: int
    text: str | None = None
    confidence: float | None = None
    bbox: BoundingBox | None = None
    createdAt: str

    @classmethod
    def from_row(cls, row: FullFrameOcrRow) -> "OcrDetection":
        """Transform database row to API model."""
        bbox = None
        if all(
            v is not None
            for v in [row.bbox_left, row.bbox_top, row.bbox_right, row.bbox_bottom]
        ):
            bbox = BoundingBox(
                left=row.bbox_left,  # type: ignore
                top=row.bbox_top,  # type: ignore
                right=row.bbox_right,  # type: ignore
                bottom=row.bbox_bottom,  # type: ignore
            )

        return cls(
            id=row.id,
            frameId=row.frame_id,
            frameIndex=row.frame_index,
            boxIndex=row.box_index,
            text=row.text,
            confidence=row.confidence,
            bbox=bbox,
            createdAt=row.created_at,
        )


class FrameOcrResult(BaseModel):
    """OCR results for a single frame."""

    frameIndex: int
    detections: list[OcrDetection]
    totalDetections: int

    @property
    def combinedText(self) -> str:
        """Combine all detection text for the frame."""
        texts = [d.text for d in self.detections if d.text]
        return " ".join(texts)


# =============================================================================
# Response Models
# =============================================================================


class OcrDetectionResponse(BaseModel):
    """Response for single OCR detection."""

    detection: OcrDetection


class OcrDetectionListResponse(BaseModel):
    """Response for listing OCR detections."""

    detections: list[OcrDetection]
    total: int


class FrameOcrResponse(BaseModel):
    """Response for frame OCR results."""

    frame: FrameOcrResult


class FrameOcrListResponse(BaseModel):
    """Response for multiple frames OCR results."""

    frames: list[FrameOcrResult]
    totalFrames: int


class OcrStatsResponse(BaseModel):
    """Response for OCR statistics."""

    totalDetections: int
    framesWithOcr: int
    avgDetectionsPerFrame: float
