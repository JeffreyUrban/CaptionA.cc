"""Central training database schema for caption boundaries detection.

This module defines the SQLAlchemy models for the central training database
that tracks datasets, training samples, cached embeddings, and experiment provenance.

Database location: local/caption_boundaries_training.db
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, LargeBinary, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


class VideoRegistry(Base):
    """Registry of all videos used in training, identified by SHA256 hash.

    The video hash provides stable identification across file moves/renames.
    This table tracks current paths and basic metadata.
    """

    __tablename__ = "video_registry"

    video_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    video_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    # Relationships
    font_embeddings: Mapped[list[FontEmbedding]] = relationship(back_populates="video", cascade="all, delete-orphan")
    ocr_visualizations: Mapped[list[OCRVisualization]] = relationship(
        back_populates="video", cascade="all, delete-orphan"
    )


class TrainingDataset(Base):
    """Training dataset with comprehensive provenance tracking.

    Tracks which videos were used, pipeline versions, splitting strategy,
    and quality metadata. Enables reproducibility and lineage tracking.
    """

    __tablename__ = "training_datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    # Dataset characteristics
    num_samples: Mapped[int] = mapped_column(Integer, nullable=False)
    num_videos: Mapped[int] = mapped_column(Integer, nullable=False)
    label_distribution: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Splitting strategy
    split_strategy: Mapped[str] = mapped_column(
        String(50), nullable=False, default="random", server_default="random"
    )
    train_split_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.8, server_default="0.8")
    random_seed: Mapped[int | None] = mapped_column(Integer)

    # Provenance: Videos
    video_hashes: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    video_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Provenance: Pipeline versions
    full_frames_version: Mapped[str | None] = mapped_column(String(50))
    crop_frames_version: Mapped[str | None] = mapped_column(String(50))
    layout_analysis_version: Mapped[str | None] = mapped_column(String(50))
    ocr_engine_version: Mapped[str | None] = mapped_column(String(100))

    # Provenance: Cropping (video_hash -> crop_bounds_version)
    crop_bounds_versions: Mapped[dict[str, int]] = mapped_column(JSON, nullable=False)

    # Quality metadata
    avg_ocr_confidence: Mapped[float | None] = mapped_column(Float)
    min_samples_per_class: Mapped[int | None] = mapped_column(Integer)

    # Relationships
    samples: Mapped[list[TrainingSample]] = relationship(back_populates="dataset", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("split_strategy IN ('random', 'show_based')", name="check_split_strategy"),
        CheckConstraint("train_split_ratio > 0 AND train_split_ratio < 1", name="check_train_split_ratio"),
    )


class TrainingSample(Base):
    """Individual training sample (frame pair) with label and provenance.

    Links to source video, frames, and original annotation. Tracks quality
    metadata and split assignment (train/val/test).
    """

    __tablename__ = "training_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_datasets.id"), nullable=False)

    # Identification
    video_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    frame1_index: Mapped[int] = mapped_column(Integer, nullable=False)
    frame2_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # Label
    label: Mapped[str] = mapped_column(String(50), nullable=False)

    # Split assignment
    split: Mapped[str] = mapped_column(String(10), nullable=False)

    # Provenance
    source_caption_annotation_id: Mapped[int | None] = mapped_column(Integer)
    crop_bounds_version: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    # Relationships
    dataset: Mapped[TrainingDataset] = relationship(back_populates="samples")

    __table_args__ = (
        CheckConstraint(
            "label IN ('same', 'different', 'empty_empty', 'empty_valid', 'valid_empty')", name="check_label"
        ),
        CheckConstraint("split IN ('train', 'val', 'test')", name="check_split"),
        Index("idx_training_samples_dataset", "dataset_id", "split"),
        Index("idx_training_samples_video", "video_hash"),
        Index("idx_training_samples_label", "label"),
        # Unique constraint on frame pair within dataset
        Index("idx_unique_frame_pair", "dataset_id", "video_hash", "frame1_index", "frame2_index", unique=True),
    )


class FontEmbedding(Base):
    """Cached FontCLIP embeddings for videos.

    Pre-trained FontCLIP model extracts 512-dim embeddings from auto-selected
    reference frames. Cache these to avoid recomputation.
    """

    __tablename__ = "font_embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_hash: Mapped[str] = mapped_column(String(64), ForeignKey("video_registry.video_hash"), nullable=False)

    # Embedding data
    embedding: Mapped[bytes] = mapped_column(Text, nullable=False)  # Serialized numpy array
    embedding_dim: Mapped[int] = mapped_column(Integer, nullable=False, default=512, server_default="512")

    # Selection metadata
    reference_frame_index: Mapped[int] = mapped_column(Integer, nullable=False)
    num_ocr_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    mean_ocr_confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Provenance
    fontclip_model_version: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    # Relationships
    video: Mapped[VideoRegistry] = relationship(back_populates="font_embeddings")

    __table_args__ = (
        # One embedding per video per model version
        Index("idx_unique_font_embedding", "video_hash", "fontclip_model_version", unique=True),
    )


class OCRVisualization(Base):
    """Cached OCR box visualizations for videos.

    Multiple variants: boundaries, centers, both, 3D channel encoding.
    Recompute only when layout or OCR changes.
    """

    __tablename__ = "ocr_visualizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_hash: Mapped[str] = mapped_column(String(64), ForeignKey("video_registry.video_hash"), nullable=False)

    # Visualization variant
    variant: Mapped[str] = mapped_column(String(50), nullable=False)

    # Visualization data
    visualization_path: Mapped[str] = mapped_column(Text, nullable=False)  # Path to cached image file

    # Provenance
    ocr_version: Mapped[str] = mapped_column(String(100), nullable=False)
    layout_version: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    # Relationships
    video: Mapped[VideoRegistry] = relationship(back_populates="ocr_visualizations")

    __table_args__ = (
        CheckConstraint("variant IN ('boundaries', 'centers', 'both', '3d_channels')", name="check_variant"),
        # One visualization per video per variant per OCR version
        Index("idx_unique_ocr_viz", "video_hash", "variant", "ocr_version", unique=True),
    )


class TrainingFrame(Base):
    """Consolidated frame storage for training datasets.

    Stores actual frame image data (BLOBs) copied from video databases
    to enable self-contained training without opening multiple databases.
    """

    __tablename__ = "training_frames"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    frame_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # Frame data
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)

    # Provenance
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    __table_args__ = (
        # One frame per (video_hash, frame_index) combination
        Index("idx_unique_training_frame", "video_hash", "frame_index", unique=True),
        # Fast lookup for dataset loading
        Index("idx_training_frame_video", "video_hash"),
    )


class TrainingOCRVisualization(Base):
    """Consolidated OCR visualizations for training datasets.

    Stores OCR visualization BLOBs for each video variant used in training.
    """

    __tablename__ = "training_ocr_visualizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    variant: Mapped[str] = mapped_column(String(50), nullable=False)

    # Visualization data
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # Provenance
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))

    __table_args__ = (
        CheckConstraint("variant IN ('boundaries', 'centers', 'both', '3d_channels')", name="check_training_ocr_variant"),
        # One visualization per (video_hash, variant) combination
        Index("idx_unique_training_ocr_viz", "video_hash", "variant", unique=True),
    )


class Experiment(Base):
    """W&B experiment tracking with model checkpoints.

    Links to W&B runs and stores checkpoint locations for reproducibility.
    """

    __tablename__ = "experiments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    dataset_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_datasets.id"), nullable=False)

    # W&B tracking
    wandb_run_id: Mapped[str | None] = mapped_column(String(255))
    wandb_project: Mapped[str | None] = mapped_column(String(255))

    # Model configuration
    model_architecture: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    hyperparameters: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Transform strategy
    transform_strategy: Mapped[str] = mapped_column(String(50), nullable=False)
    ocr_visualization_variant: Mapped[str] = mapped_column(String(50), nullable=False)
    use_font_embedding: Mapped[bool] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Training results
    best_val_f1: Mapped[float | None] = mapped_column(Float)
    best_val_accuracy: Mapped[float | None] = mapped_column(Float)
    best_checkpoint_path: Mapped[str | None] = mapped_column(Text)
    final_checkpoint_path: Mapped[str | None] = mapped_column(Text)

    # Timing
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Git provenance
    git_commit: Mapped[str | None] = mapped_column(String(40))
    git_branch: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (
        CheckConstraint(
            "transform_strategy IN ('crop', 'mirror_tile', 'adaptive')", name="check_transform_strategy"
        ),
        CheckConstraint(
            "ocr_visualization_variant IN ('boundaries', 'centers', 'both', '3d_channels')",
            name="check_ocr_variant",
        ),
    )
