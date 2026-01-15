"""
Base Model Update Flow

Handles updating the global Bayesian base model and retraining all affected videos.

The base model represents default priors for box classification (caption vs noise).
Each video has its own model = base model + posterior from video's labeled boxes.

When the base model is updated (e.g., with new global training data or improved priors),
all videos with existing models need to be retrained to incorporate the new base.

Architecture:
- Base model: Global default priors, shared across all videos
- Video model: Base model + video-specific labeled boxes from full_frame_box_labels

This flow:
1. Updates the global base model parameters
2. Identifies all videos with trained models
3. Queues retrain flows for each affected video
4. Updates predictions across all videos

TODO: Implementation Requirements
================================

1. **Base Model Storage**
   - WHERE: Global location for base model parameters (not per-video)
   - OPTIONS:
     a) File: services/orchestrator/models/base_model.json
     b) Database: Global SQLite database
     c) Config: YAML/JSON in services/orchestrator/config/
   - DECISION NEEDED: Choose storage location

2. **Base Model Training Logic**
   - Aggregate training data from all videos
   - Train Gaussian Naive Bayes classifier
   - Extract mean/std for each feature per class
   - Save as base model parameters
   - CODE LOCATION: TBD (new module: services/orchestrator/ml/base_model.py?)

3. **Video Model Training Logic**
   - Load base model parameters
   - Load video's user labels from full_frame_box_labels
   - Combine base priors with video posteriors (Bayesian update)
   - Save to video's box_classification_model table
   - CODE LOCATION: TBD (existing? or new?)

4. **Feature Extraction**
   - Extract features from OCR boxes for model training
   - Features: vertical_alignment, height_similarity, anchor_distance, etc.
   - CODE LOCATION: TBD (shared utility?)

5. **Trigger Mechanism**
   - MANUAL: Admin endpoint to trigger base model update
   - PERIODIC: Scheduled task (e.g., weekly)
   - THRESHOLD: After N new labels across all videos
   - DECISION NEEDED: Choose trigger strategy
"""

import json
from pathlib import Path
from typing import Any

from prefect import flow, task

# =============================================================================
# TODO: Base Model Storage
# =============================================================================


def get_base_model_path() -> Path:
    """
    Get path to base model file.

    TODO: Implement base model storage location.
    Options:
    - JSON file: services/orchestrator/models/base_model.json
    - SQLite: services/orchestrator/data/base_model.db
    - Config: services/orchestrator/config/base_model.yaml
    """
    # Placeholder: Use JSON file for now
    return Path(__file__).parent.parent / "models" / "base_model.json"


def load_base_model() -> dict[str, Any]:
    """
    Load base model parameters.

    TODO: Implement base model loading.
    Should return dict with:
    - model_version: str
    - prior_in: float
    - prior_out: float
    - feature_params: dict[str, dict[str, float]]
        e.g., {"in_vertical_alignment_mean": 0.5, "in_vertical_alignment_std": 0.1, ...}
    """
    path = get_base_model_path()
    if not path.exists():
        # Return default base model
        return {
            "model_version": "base_v1",
            "prior_in": 0.5,
            "prior_out": 0.5,
            "feature_params": {},
            "trained_at": None,
            "training_samples": 0,
        }

    with open(path) as f:
        return json.load(f)


def save_base_model(model: dict[str, Any]) -> None:
    """
    Save base model parameters.

    TODO: Implement base model saving.
    """
    path = get_base_model_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w") as f:
        json.dump(model, f, indent=2)


# =============================================================================
# TODO: Base Model Training
# =============================================================================


@task(
    name="train-base-model",
    tags=["model-training", "base-model"],
    log_prints=True,
)
def train_base_model(
    training_data_source: str = "all_videos",
) -> dict[str, Any]:
    """
    Train the global base model from aggregated training data.

    TODO: Implement base model training logic.

    Steps:
    1. Aggregate training data from all videos
       - Query all databases for user labels (full_frame_box_labels where label_source='user')
    2. Extract features for each labeled box
       - Load OCR boxes from full_frame_ocr
       - Load video_layout_config for anchor/bounds
       - Calculate features (vertical_alignment, height_similarity, etc.)
    3. Train Gaussian Naive Bayes
       - Calculate class priors (P(in), P(out))
       - Calculate mean and std for each feature per class
    4. Package as base model parameters
    5. Save to base model storage

    Args:
        training_data_source: Source of training data
            - "all_videos": Aggregate from all videos
            - "curated": Use curated global dataset
            - "recent": Use recent labels only

    Returns:
        Dict with base model parameters
    """
    print(f"[TrainBaseModel] Training base model from: {training_data_source}")

    # TODO: Implement training logic here
    # For now, return a placeholder

    base_model = {
        "model_version": "base_v2_placeholder",
        "prior_in": 0.7,  # Placeholder: 70% of boxes are captions
        "prior_out": 0.3,  # Placeholder: 30% are noise
        "feature_params": {
            # TODO: Calculate actual feature statistics
            "in_vertical_alignment_mean": 0.0,
            "in_vertical_alignment_std": 0.1,
            # ... add all features from schema
        },
        "trained_at": "placeholder",
        "training_samples": 0,
    }

    print(f"[TrainBaseModel] Trained base model: {base_model['model_version']}")
    return base_model


@task(
    name="update-base-model-storage",
    tags=["database"],
    log_prints=True,
)
def update_base_model_storage(base_model: dict[str, Any]) -> None:
    """
    Save updated base model to storage.

    Args:
        base_model: Base model parameters
    """
    print(f"[UpdateBaseModel] Saving base model: {base_model['model_version']}")
    save_base_model(base_model)
    print("[UpdateBaseModel] Base model saved successfully")


# =============================================================================
# TODO: Video Discovery
# =============================================================================


@task(
    name="find-videos-with-models",
    tags=["database"],
    log_prints=True,
)
def find_videos_with_models(data_dir: str) -> list[dict[str, str]]:
    """
    Find all videos that have trained models.

    TODO: Implement video discovery.

    Should scan data directory for all video databases and check for
    box_classification_model table with trained model.

    Args:
        data_dir: Path to data directory (e.g., local/data/)

    Returns:
        List of dicts with video_id, db_path, display_path
    """
    print(f"[FindVideos] Scanning for videos with models in: {data_dir}")

    # TODO: Implement video discovery
    # For now, return empty list
    videos = []

    print(f"[FindVideos] Found {len(videos)} videos with trained models")
    return videos


# =============================================================================
# Main Flow
# =============================================================================


@flow(
    name="update-base-model-globally",
    log_prints=True,
)
def base_model_update_flow(
    data_dir: str,
    training_source: str = "all_videos",
    retrain_videos: bool = True,
) -> dict[str, Any]:
    """
    Update global base model and optionally retrain all video models.

    This is a manual/scheduled flow to:
    1. Train new base model from aggregated data
    2. Save updated base model
    3. Optionally queue retrain for all affected videos

    Priority: Low (admin/maintenance task)

    Args:
        data_dir: Path to data directory containing video databases
        training_source: Source for base model training
        retrain_videos: Whether to retrain all video models with new base

    Returns:
        Dict with update results
    """
    print("=" * 80)
    print("Starting Base Model Update")
    print("=" * 80)
    print()

    # Train new base model
    new_base_model = train_base_model(training_source)

    # Save to storage
    update_base_model_storage(new_base_model)

    result = {
        "base_model_version": new_base_model["model_version"],
        "training_samples": new_base_model.get("training_samples", 0),
        "status": "complete",
    }

    # Optionally retrain all videos
    if retrain_videos:
        videos = find_videos_with_models(data_dir)
        result["videos_to_retrain"] = len(videos)

        print()
        print(f"Found {len(videos)} videos to retrain")
        print()

        # TODO: Queue retrain flows for each video
        # This would call retrain_video_model_flow for each video
        # For now, just log what would happen
        for video in videos:
            print(f"TODO: Queue retrain for {video.get('video_id', 'unknown')}")

    print()
    print("=" * 80)
    print("Base Model Update Complete")
    print("=" * 80)

    return result
