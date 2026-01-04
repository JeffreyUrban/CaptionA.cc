"""
Video Model Retrain Flow

Retrains a single video's box classification model with updated base model.

Each video has a Gaussian Naive Bayes model stored in box_classification_model table.
The model combines:
- Base model: Global default priors
- Video-specific posteriors: From user labels in full_frame_box_labels

When triggered:
1. Loads current base model
2. Loads video's user labels
3. Trains video-specific model (base + video posteriors)
4. Saves to box_classification_model table
5. Updates all predictions in full_frame_ocr

Triggered by:
- Base model update (retrains all videos)
- User labels new boxes (retrains this video)
- Manual retrain request

TODO: Implementation Requirements
================================

1. **Feature Extraction**
   - Extract features from OCR boxes for model training
   - Features needed (from schema):
     * Geometric: vertical_alignment, height_similarity, anchor_distance, crop_overlap,
                  aspect_ratio, normalized_y, normalized_area
     * Position: normalized_left/top/right/bottom
     * Temporal: time_from_start, time_from_end
     * Character set: is_roman, is_hanzi, is_arabic, is_korean, etc.
     * User annotations: user_annotated_in, user_annotated_out
   - CODE LOCATION: TBD (new module: services/orchestrator/ml/features.py?)

2. **Bayesian Model Training**
   - Combine base priors with video-specific data
   - Calculate posterior distributions
   - Update using Bayes' theorem
   - CODE LOCATION: TBD (new module: services/orchestrator/ml/bayesian_model.py?)

3. **Model Persistence**
   - Save all 100+ feature parameters to box_classification_model table
   - Handle model versioning
   - Track training metadata (n_samples, trained_at, etc.)
   - SCHEMA: Already defined in annotations-schema.sql ✓

4. **Prediction Updates**
   - Apply trained model to all boxes in full_frame_ocr
   - Update predicted_label, predicted_confidence, model_version
   - Efficient batch processing for large videos
   - CODE LOCATION: TBD

5. **UI Integration** (Future)
   - Manual retrain button in Layout Annotation UI
   - Automatic retrain after N labels
   - Show model stats (accuracy, n_samples, etc.)
   - DECISION NEEDED: Trigger strategy
"""

import sqlite3
from pathlib import Path
from typing import Any

from prefect import flow, task

from .base_model_update import load_base_model


# =============================================================================
# TODO: Feature Extraction
# =============================================================================

@task(
    name="extract-box-features",
    tags=["feature-extraction", "ml"],
    log_prints=True,
)
def extract_box_features(
    db_path: str,
    box_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Extract features from OCR boxes for model training.

    TODO: Implement feature extraction logic.

    Should extract features defined in box_classification_model schema:
    - Geometric features (from OCR box + layout config)
    - Position features (normalized coordinates)
    - Temporal features (position in video timeline)
    - Character set features (language detection)
    - User annotation features (if box has been labeled)

    Args:
        db_path: Path to video annotations.db
        box_ids: Specific box IDs to extract (None = all boxes)

    Returns:
        List of feature dicts, one per box
    """
    print(f"[ExtractFeatures] Extracting features from: {db_path}")

    # TODO: Implement feature extraction
    # For now, return empty list
    features = []

    print(f"[ExtractFeatures] Extracted features for {len(features)} boxes")
    return features


# =============================================================================
# TODO: Model Training
# =============================================================================

@task(
    name="train-video-model",
    tags=["model-training", "video-model"],
    log_prints=True,
)
def train_video_model(
    video_id: str,
    db_path: str,
    base_model: dict[str, Any],
) -> dict[str, Any]:
    """
    Train video-specific model using base model + video labels.

    TODO: Implement video model training logic.

    Steps:
    1. Load user labels from full_frame_box_labels
    2. Extract features for labeled boxes
    3. Load base model parameters
    4. Combine base priors with video data (Bayesian update)
    5. Train Gaussian Naive Bayes classifier
    6. Package model parameters

    Args:
        video_id: Video UUID
        db_path: Path to annotations.db
        base_model: Base model parameters

    Returns:
        Dict with video model parameters (matches box_classification_model schema)
    """
    print(f"[TrainVideoModel] Training model for video: {video_id}")
    print(f"[TrainVideoModel] Using base model: {base_model['model_version']}")

    conn = sqlite3.connect(db_path)
    try:
        # Get count of user labels
        cursor = conn.execute(
            "SELECT COUNT(*) FROM full_frame_box_labels WHERE label_source = 'user'"
        )
        n_labels = cursor.fetchone()[0]

        print(f"[TrainVideoModel] Found {n_labels} user labels")

        if n_labels == 0:
            print("[TrainVideoModel] No user labels - using base model only")
            # Return base model as video model
            return {
                "model_version": f"{base_model['model_version']}_video",
                "trained_at": "placeholder",
                "n_training_samples": 0,
                **base_model.get("feature_params", {}),
            }

        # TODO: Implement actual training
        # For now, return placeholder

        video_model = {
            "model_version": f"{base_model['model_version']}_video_{video_id[:8]}",
            "trained_at": "placeholder",
            "n_training_samples": n_labels,
            "prior_in": base_model.get("prior_in", 0.5),
            "prior_out": base_model.get("prior_out", 0.5),
            # TODO: Add all feature parameters from training
        }

        print(f"[TrainVideoModel] Training complete: {video_model['model_version']}")
        return video_model

    finally:
        conn.close()


@task(
    name="save-video-model",
    tags=["database"],
    log_prints=True,
)
def save_video_model(
    db_path: str,
    model: dict[str, Any],
) -> None:
    """
    Save trained model to box_classification_model table.

    Args:
        db_path: Path to annotations.db
        model: Model parameters
    """
    print(f"[SaveVideoModel] Saving model to: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        # TODO: Implement proper model saving with all parameters
        # For now, just update basic fields

        conn.execute(
            """
            INSERT OR REPLACE INTO box_classification_model (
                id, model_version, trained_at, n_training_samples,
                prior_in, prior_out
            ) VALUES (1, ?, ?, ?, ?, ?)
            """,
            (
                model["model_version"],
                model["trained_at"],
                model["n_training_samples"],
                model.get("prior_in", 0.5),
                model.get("prior_out", 0.5),
            ),
        )

        conn.commit()
        print(f"[SaveVideoModel] Model saved successfully")

    finally:
        conn.close()


# =============================================================================
# TODO: Prediction Updates
# =============================================================================

@task(
    name="update-box-predictions",
    tags=["prediction", "ml"],
    log_prints=True,
)
def update_box_predictions(
    db_path: str,
    model: dict[str, Any],
) -> dict[str, int]:
    """
    Apply trained model to update predictions for all boxes.

    TODO: Implement prediction logic.

    Steps:
    1. Load model parameters
    2. For each box in full_frame_ocr:
       - Extract features
       - Calculate P(in|features) and P(out|features)
       - Set predicted_label to class with higher probability
       - Set predicted_confidence
    3. Update full_frame_ocr table with predictions

    Args:
        db_path: Path to annotations.db
        model: Trained model parameters

    Returns:
        Dict with prediction stats (total_boxes, predicted_in, predicted_out)
    """
    print(f"[UpdatePredictions] Updating predictions with model: {model['model_version']}")

    conn = sqlite3.connect(db_path)
    try:
        # Get count of boxes
        cursor = conn.execute("SELECT COUNT(*) FROM full_frame_ocr")
        total_boxes = cursor.fetchone()[0]

        print(f"[UpdatePredictions] Processing {total_boxes} boxes")

        # TODO: Implement actual prediction updates
        # For now, just log what would happen

        stats = {
            "total_boxes": total_boxes,
            "predicted_in": 0,  # TODO: Count after predictions
            "predicted_out": 0,  # TODO: Count after predictions
        }

        print(f"[UpdatePredictions] Predictions updated: {stats}")
        return stats

    finally:
        conn.close()


# =============================================================================
# Main Flow
# =============================================================================

@flow(
    name="retrain-video-model",
    log_prints=True,
    retries=1,
    retry_delay_seconds=60,
)
def retrain_video_model_flow(
    video_id: str,
    db_path: str,
    update_predictions: bool = True,
) -> dict[str, Any]:
    """
    Retrain video's box classification model and update predictions.

    This flow:
    1. Loads current base model
    2. Trains video-specific model from user labels
    3. Saves model to box_classification_model table
    4. Optionally updates predictions for all boxes

    Triggered by:
    - Base model update (retrain all videos)
    - User labels new boxes (retrain this video)
    - Manual retrain request from UI

    Priority: Medium (user-initiated) or Low (batch retrain)

    Args:
        video_id: Video UUID
        db_path: Path to video's annotations.db
        update_predictions: Whether to update box predictions

    Returns:
        Dict with training results
    """
    print(f"Starting model retrain for video: {video_id}")

    # Load base model
    base_model = load_base_model()
    print(f"Loaded base model: {base_model.get('model_version', 'unknown')}")

    # Train video-specific model
    video_model = train_video_model(
        video_id=video_id,
        db_path=db_path,
        base_model=base_model,
    )

    # Save model to database
    save_video_model(db_path=db_path, model=video_model)

    result = {
        "video_id": video_id,
        "model_version": video_model["model_version"],
        "training_samples": video_model["n_training_samples"],
        "status": "complete",
    }

    # Update predictions if requested
    if update_predictions:
        prediction_stats = update_box_predictions(
            db_path=db_path,
            model=video_model,
        )
        result["prediction_stats"] = prediction_stats

    print(f"Model retrain complete for {video_id}")
    return result
