"""SQLModel table definitions for layout.db."""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    """Return timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


class LayoutDatabaseMetadata(SQLModel, table=True):
    """Database metadata for schema versioning (single-row table).

    Note: Uses __table_args__ with extend_existing because multiple databases
    have tables with the same name in different SQLite files.
    """

    __tablename__ = "database_metadata"
    __table_args__ = {"extend_existing": True}

    id: int = Field(default=1, primary_key=True)
    schema_version: int = Field(default=1)
    created_at: datetime = Field(default_factory=utc_now)
    migrated_at: Optional[datetime] = None


class VideoLayoutConfig(SQLModel, table=True):
    """Video layout configuration including crop region and analysis results."""

    __tablename__ = "video_layout_config"

    id: int = Field(default=1, primary_key=True)
    frame_width: int
    frame_height: int
    crop_left: int = Field(default=0)
    crop_top: int = Field(default=0)
    crop_right: int = Field(default=0)
    crop_bottom: int = Field(default=0)
    selection_left: Optional[int] = None
    selection_top: Optional[int] = None
    selection_right: Optional[int] = None
    selection_bottom: Optional[int] = None
    selection_mode: str = Field(default="disabled")
    vertical_position: Optional[float] = None
    vertical_std: Optional[float] = None
    box_height: Optional[float] = None
    box_height_std: Optional[float] = None
    anchor_type: Optional[str] = None
    anchor_position: Optional[float] = None
    top_edge_std: Optional[float] = None
    bottom_edge_std: Optional[float] = None
    horizontal_std_slope: Optional[float] = None
    horizontal_std_intercept: Optional[float] = None
    crop_region_version: int = Field(default=1)
    analysis_model_version: Optional[str] = None
    updated_at: datetime = Field(default_factory=utc_now)


class FullFrameBoxLabel(SQLModel, table=True):
    """Box classification labels from user or model predictions."""

    __tablename__ = "full_frame_box_labels"

    id: Optional[int] = Field(default=None, primary_key=True)
    frame_index: int
    box_index: int
    label: str  # 'in' or 'out'
    label_source: str = Field(default="user")  # 'user' or 'model'
    created_at: datetime = Field(default_factory=utc_now)


class BoxClassificationModel(SQLModel, table=True):
    """Trained box classification model (single-row table)."""

    __tablename__ = "box_classification_model"

    id: int = Field(default=1, primary_key=True)
    model_data: Optional[bytes] = None
    model_version: Optional[str] = None
    trained_at: Optional[datetime] = None


class VideoPreferences(SQLModel, table=True):
    """User preferences for video processing (single-row table)."""

    __tablename__ = "video_preferences"

    id: int = Field(default=1, primary_key=True)
    layout_approved: bool = Field(default=False)
