"""SQLModel table definitions for SQLite databases."""

from app.models.tables.captions_db import (
    Caption,
    CaptionsDatabaseMetadata,
)
from app.models.tables.layout_db import (
    BoxClassificationModel,
    FullFrameBoxLabel,
    LayoutDatabaseMetadata,
    VideoLayoutConfig,
    VideoPreferences,
)
from app.models.tables.ocr_db import FullFrameOcr
from app.models.tables.boundaries_db import (
    BoundariesRunMetadata,
    PairResult,
)

__all__ = [
    # captions.db
    "Caption",
    "CaptionsDatabaseMetadata",
    # layout.db
    "BoxClassificationModel",
    "FullFrameBoxLabel",
    "LayoutDatabaseMetadata",
    "VideoLayoutConfig",
    "VideoPreferences",
    # fullOCR.db
    "FullFrameOcr",
    # boundaries inference db
    "BoundariesRunMetadata",
    "PairResult",
]
