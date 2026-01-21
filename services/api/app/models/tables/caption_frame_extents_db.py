"""SQLModel table definitions for caption frame extents inference database."""

from typing import Optional

from sqlmodel import Field, SQLModel


class CaptionFrameExtentsRunMetadata(SQLModel, table=True):
    """Metadata for a caption frame extents inference run (single-row per database file)."""

    __tablename__ = "run_metadata"  # pyright: ignore[reportAssignmentType]

    run_id: str = Field(primary_key=True)
    cropped_frames_version: int
    model_version: str
    model_checkpoint_path: Optional[str] = None
    started_at: str  # ISO 8601 timestamp
    completed_at: str  # ISO 8601 timestamp
    total_pairs: int
    processing_time_seconds: Optional[float] = None


class PairResult(SQLModel, table=True):
    """Frame pair inference results with forward and backward predictions."""

    __tablename__ = "pair_results"  # pyright: ignore[reportAssignmentType]

    id: Optional[int] = Field(default=None, primary_key=True)
    frame1_index: int
    frame2_index: int

    # Forward direction: frame1 -> frame2
    forward_predicted_label: (
        str  # 'same', 'different', 'empty_empty', 'empty_valid', 'valid_empty'
    )
    forward_confidence: float
    forward_prob_same: float
    forward_prob_different: float
    forward_prob_empty_empty: float
    forward_prob_empty_valid: float
    forward_prob_valid_empty: float

    # Backward direction: frame2 -> frame1
    backward_predicted_label: (
        str  # 'same', 'different', 'empty_empty', 'empty_valid', 'valid_empty'
    )
    backward_confidence: float
    backward_prob_same: float
    backward_prob_different: float
    backward_prob_empty_empty: float
    backward_prob_empty_valid: float
    backward_prob_valid_empty: float

    # Processing metadata
    processing_time_ms: Optional[float] = None
