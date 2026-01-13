"""Unit tests for training database schema."""

import tempfile
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from caption_boundaries.database import (
    Experiment,
    OCRVisualization,
    TrainingDataset,
    TrainingSample,
    VideoRegistry,
    create_dataset_session,
    init_dataset_db,
)


@pytest.fixture
def test_db():
    """Create a temporary test database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        init_dataset_db(db_path)
        db = create_dataset_session(db_path)
        try:
            yield db
        finally:
            db.close()


@pytest.mark.unit
def test_video_registry_creation(test_db):
    """Test creating video registry entries."""
    video = VideoRegistry(
        video_hash="a" * 64,
        video_path="/path/to/video.mp4",
        file_size_bytes=1024 * 1024 * 500,  # 500MB
        duration_seconds=1800.0,
        width=1920,
        height=1080,
    )

    test_db.add(video)
    test_db.commit()

    # Retrieve and verify
    retrieved = test_db.query(VideoRegistry).filter(VideoRegistry.video_hash == "a" * 64).first()
    assert retrieved is not None
    assert retrieved.video_path == "/path/to/video.mp4"
    assert retrieved.file_size_bytes == 1024 * 1024 * 500
    assert retrieved.first_seen_at is not None
    assert retrieved.last_seen_at is not None


@pytest.mark.unit
def test_training_dataset_creation(test_db):
    """Test creating training dataset with provenance."""
    dataset = TrainingDataset(
        name="test_dataset_v1",
        description="Test dataset for unit tests",
        num_samples=1000,
        num_videos=5,
        label_distribution={"same": 400, "different": 300, "empty_empty": 150, "empty_valid": 75, "valid_empty": 75},
        split_strategy="random",
        train_split_ratio=0.8,
        random_seed=42,
        video_hashes=["a" * 64, "b" * 64, "c" * 64],
        video_metadata={"a" * 64: {"path": "/path/to/video1.mp4"}, "b" * 64: {"path": "/path/to/video2.mp4"}},
        crop_bounds_versions={"a" * 64: 1, "b" * 64: 2},
        full_frames_version="1.0.0",
        crop_frames_version="1.0.0",
        layout_analysis_version="1.0.0",
        ocr_engine_version="macos_livetext_14.5",
        avg_ocr_confidence=0.92,
        min_samples_per_class=75,
    )

    test_db.add(dataset)
    test_db.commit()

    # Retrieve and verify
    retrieved = test_db.query(TrainingDataset).filter(TrainingDataset.name == "test_dataset_v1").first()
    assert retrieved is not None
    assert retrieved.num_samples == 1000
    assert retrieved.num_videos == 5
    assert retrieved.split_strategy == "random"
    assert retrieved.train_split_ratio == 0.8
    assert retrieved.random_seed == 42
    assert len(retrieved.video_hashes) == 3
    assert retrieved.label_distribution["same"] == 400
    assert retrieved.full_frames_version == "1.0.0"


@pytest.mark.unit
def test_training_sample_creation(test_db):
    """Test creating training samples linked to dataset."""
    # First create dataset
    dataset = TrainingDataset(
        name="sample_dataset",
        description="Dataset for sample test",
        num_samples=1,
        num_videos=1,
        label_distribution={"same": 1},
        video_hashes=["a" * 64],
        video_metadata={},
        crop_bounds_versions={"a" * 64: 1},
    )
    test_db.add(dataset)
    test_db.commit()

    # Create sample
    sample = TrainingSample(
        dataset_id=dataset.id,
        video_hash="a" * 64,
        frame1_index=100,
        frame2_index=101,
        label="same",
        split="train",
        crop_bounds_version=1,
    )

    test_db.add(sample)
    test_db.commit()

    # Retrieve and verify
    retrieved = test_db.query(TrainingSample).filter(TrainingSample.video_hash == "a" * 64).first()
    assert retrieved is not None
    assert retrieved.dataset_id == dataset.id
    assert retrieved.frame1_index == 100
    assert retrieved.frame2_index == 101
    assert retrieved.label == "same"
    assert retrieved.split == "train"
    assert retrieved.crop_bounds_version == 1


@pytest.mark.unit
def test_ocr_visualization_creation(test_db):
    """Test creating OCR visualizations."""
    # Create video first
    video = VideoRegistry(
        video_hash="a" * 64,
        video_path="/path/to/video.mp4",
        file_size_bytes=1024 * 1024 * 500,
    )
    test_db.add(video)
    test_db.commit()

    # Create visualization
    viz = OCRVisualization(
        video_hash="a" * 64,
        variant="boundaries",
        visualization_path="/cache/ocr_viz/a_boundaries.png",
        ocr_version="macos_livetext_14.5",
        layout_version="1.0.0",
    )

    test_db.add(viz)
    test_db.commit()

    # Retrieve and verify
    retrieved = test_db.query(OCRVisualization).filter(OCRVisualization.video_hash == "a" * 64).first()
    assert retrieved is not None
    assert retrieved.variant == "boundaries"
    assert retrieved.visualization_path == "/cache/ocr_viz/a_boundaries.png"
    assert retrieved.ocr_version == "macos_livetext_14.5"

    # Verify relationship
    assert retrieved.video is not None
    assert retrieved.video.video_hash == "a" * 64


@pytest.mark.unit
def test_experiment_creation(test_db):
    """Test creating experiment records."""
    # Create dataset first
    dataset = TrainingDataset(
        name="exp_dataset",
        description="Dataset for experiment test",
        num_samples=1000,
        num_videos=5,
        label_distribution={"same": 400, "different": 300, "empty_empty": 150, "empty_valid": 75, "valid_empty": 75},
        video_hashes=["a" * 64],
        video_metadata={},
        crop_bounds_versions={"a" * 64: 1},
    )
    test_db.add(dataset)
    test_db.commit()

    # Create experiment
    experiment = Experiment(
        name="baseline_exp_v1",
        dataset_id=dataset.id,
        wandb_run_id="abc123",
        wandb_project="caption-boundary-detection",
        architecture_name="triple_backbone_resnet50",
        model_config={"backbone": "resnet50", "num_frames": 3},
        hyperparameters={"lr": 1e-4, "batch_size": 128, "epochs": 50},
        transform_strategy="mirror_tile",
        ocr_visualization_variant="boundaries",
        use_font_embedding=True,
        best_val_f1=0.92,
        best_val_accuracy=0.94,
        best_checkpoint_path="/checkpoints/best.pt",
        git_commit="test-commit-hash",
        git_branch="main",
    )

    test_db.add(experiment)
    test_db.commit()

    # Retrieve and verify
    retrieved = test_db.query(Experiment).filter(Experiment.name == "baseline_exp_v1").first()
    assert retrieved is not None
    assert retrieved.dataset_id == dataset.id
    assert retrieved.wandb_run_id == "abc123"
    assert retrieved.transform_strategy == "mirror_tile"
    assert retrieved.ocr_visualization_variant == "boundaries"
    assert retrieved.use_font_embedding  # SQLite stores as integer (1)
    assert retrieved.best_val_f1 == 0.92
    assert retrieved.architecture_name == "triple_backbone_resnet50"
    assert retrieved.model_config["backbone"] == "resnet50"


@pytest.mark.unit
def test_unique_constraints(test_db):
    """Test unique constraints are enforced."""
    # Create dataset
    dataset = TrainingDataset(
        name="unique_test",
        description="Test unique constraints",
        num_samples=2,
        num_videos=1,
        label_distribution={"same": 2},
        video_hashes=["a" * 64],
        video_metadata={},
        crop_bounds_versions={"a" * 64: 1},
    )
    test_db.add(dataset)
    test_db.commit()

    # Create first sample
    sample1 = TrainingSample(
        dataset_id=dataset.id,
        video_hash="a" * 64,
        frame1_index=100,
        frame2_index=101,
        label="same",
        split="train",
        crop_bounds_version=1,
    )
    test_db.add(sample1)
    test_db.commit()

    # Try to create duplicate sample (should fail)
    sample2 = TrainingSample(
        dataset_id=dataset.id,
        video_hash="a" * 64,
        frame1_index=100,
        frame2_index=101,  # Same frame pair!
        label="different",  # Even with different label
        split="val",
        crop_bounds_version=1,
    )
    test_db.add(sample2)

    with pytest.raises(IntegrityError):  # Unique constraint violation
        test_db.commit()
