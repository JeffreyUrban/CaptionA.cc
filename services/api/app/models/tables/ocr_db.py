"""SQLModel table definitions for fullOCR.db."""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class FullFrameOcr(SQLModel, table=True):
    """OCR detection results for full frames."""

    __tablename__ = "full_frame_ocr"  # pyright: ignore[reportAssignmentType]

    id: Optional[int] = Field(default=None, primary_key=True)
    frame_id: int
    frame_index: int
    box_index: int
    text: Optional[str] = None
    confidence: Optional[float] = None
    bbox_left: Optional[int] = None
    bbox_top: Optional[int] = None
    bbox_right: Optional[int] = None
    bbox_bottom: Optional[int] = None
    created_at: datetime = Field(default_factory=utc_now)
