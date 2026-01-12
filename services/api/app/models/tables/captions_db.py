"""SQLModel table definitions for captions.db."""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class CaptionsDatabaseMetadata(SQLModel, table=True):
    """Database metadata for schema versioning (key-value store).

    Note: Uses __table_args__ with extend_existing because multiple databases
    have tables with the same name in different SQLite files.
    """

    __tablename__ = "database_metadata"
    __table_args__ = {"extend_existing": True}

    key: str = Field(primary_key=True)
    value: str


class Caption(SQLModel, table=True):
    """Caption row in captions.db."""

    __tablename__ = "captions"

    id: Optional[int] = Field(default=None, primary_key=True)
    start_frame_index: int
    end_frame_index: int
    boundary_state: str = Field(default="predicted")  # 'predicted', 'confirmed', 'gap'
    boundary_pending: bool = Field(default=True)
    boundary_updated_at: datetime = Field(default_factory=utc_now)
    text: Optional[str] = None
    text_pending: bool = Field(default=True)
    text_status: Optional[str] = None
    text_notes: Optional[str] = None
    caption_ocr: Optional[str] = None
    text_updated_at: datetime = Field(default_factory=utc_now)
    image_needs_regen: bool = Field(default=False)
    caption_ocr_status: str = Field(default="queued")
    caption_ocr_error: Optional[str] = None
    caption_ocr_processed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
