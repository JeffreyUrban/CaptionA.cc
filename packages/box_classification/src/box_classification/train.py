"""Training pipeline for box classification model."""

from pathlib import Path
import sqlite3

import numpy as np

from .features import BoxBounds, VideoLayoutConfig, extract_features
from .model import ModelParams, train_gaussian_naive_bayes


def get_layout_config(db: sqlite3.Connection) -> VideoLayoutConfig:
    """Load layout configuration from database."""
    db.row_factory = sqlite3.Row
    cursor = db.cursor()

    query = 'SELECT * FROM video_layout_config WHERE id = 1'
    cursor.execute(query)
    row = cursor.fetchone()

    if not row:
        raise ValueError('Layout config not found in database')

    return {
        'frame_width': row['frame_width'],
        'frame_height': row['frame_height'],
        'crop_left': row['crop_left'],
        'crop_top': row['crop_top'],
        'crop_right': row['crop_right'],
        'crop_bottom': row['crop_bottom'],
        'vertical_position': row['vertical_position'],
        'vertical_std': row['vertical_std'],
        'box_height': row['box_height'],
        'box_height_std': row['box_height_std'],
        'anchor_type': row['anchor_type'],
        'anchor_position': row['anchor_position'],
    }


def load_training_data(db: sqlite3.Connection, layout_config: VideoLayoutConfig) -> tuple[np.ndarray, np.ndarray]:
    """
    Load user annotations and extract features.

    Loads annotations from both full frames and cropped frames.
    All coordinates are already stored in full-frame absolute pixels.

    Returns:
        Tuple of (features, labels) where:
        - features: (n_samples, 7) array of feature vectors
        - labels: (n_samples,) array of labels (0=out, 1=in)
    """
    db.row_factory = sqlite3.Row
    cursor = db.cursor()

    # Query all user annotations (from both full frames and cropped frames)
    # Coordinates are already in full-frame absolute pixels
    query = '''
        SELECT
            annotation_source,
            box_left,
            box_top,
            box_right,
            box_bottom,
            label
        FROM full_frame_box_labels
        WHERE label_source = 'user'
    '''

    cursor.execute(query)
    rows = cursor.fetchall()

    if not rows or len(rows) == 0:
        raise ValueError('No user annotations found in database')

    features_list = []
    labels_list = []

    for row in rows:
        # Use absolute pixel coordinates directly from the labels table
        box: BoxBounds = {
            'left': row['box_left'],
            'top': row['box_top'],
            'right': row['box_right'],
            'bottom': row['box_bottom'],
        }

        # Extract 7 features
        feature_vector = extract_features(box, layout_config)
        features_list.append(feature_vector)

        # Convert label to numeric: 'in' -> 1, 'out' -> 0
        label = 1 if row['label'] == 'in' else 0
        labels_list.append(label)

    features = np.array(features_list, dtype=np.float64)
    labels = np.array(labels_list, dtype=np.int32)

    return features, labels


def save_model_to_db(db: sqlite3.Connection, model: ModelParams) -> None:
    """Save trained model parameters to database."""
    cursor = db.cursor()

    # Delete existing model (if any)
    cursor.execute('DELETE FROM box_classification_model WHERE id = 1')

    # Insert new model
    insert_query = '''
        INSERT INTO box_classification_model (
            id,
            model_version,
            trained_at,
            n_training_samples,
            prior_in,
            prior_out,
            -- "in" class features
            in_vertical_alignment_mean,
            in_vertical_alignment_std,
            in_height_similarity_mean,
            in_height_similarity_std,
            in_anchor_distance_mean,
            in_anchor_distance_std,
            in_crop_overlap_mean,
            in_crop_overlap_std,
            in_aspect_ratio_mean,
            in_aspect_ratio_std,
            in_normalized_y_mean,
            in_normalized_y_std,
            in_normalized_area_mean,
            in_normalized_area_std,
            -- "out" class features
            out_vertical_alignment_mean,
            out_vertical_alignment_std,
            out_height_similarity_mean,
            out_height_similarity_std,
            out_anchor_distance_mean,
            out_anchor_distance_std,
            out_crop_overlap_mean,
            out_crop_overlap_std,
            out_aspect_ratio_mean,
            out_aspect_ratio_std,
            out_normalized_y_mean,
            out_normalized_y_std,
            out_normalized_area_mean,
            out_normalized_area_std
        ) VALUES (
            1, ?, datetime('now'), ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    '''

    in_features = model['in_features']
    out_features = model['out_features']

    cursor.execute(insert_query, (
        model['model_version'],
        model['n_training_samples'],
        model['prior_in'],
        model['prior_out'],
        # "in" class
        in_features[0]['mean'], in_features[0]['std'],
        in_features[1]['mean'], in_features[1]['std'],
        in_features[2]['mean'], in_features[2]['std'],
        in_features[3]['mean'], in_features[3]['std'],
        in_features[4]['mean'], in_features[4]['std'],
        in_features[5]['mean'], in_features[5]['std'],
        in_features[6]['mean'], in_features[6]['std'],
        # "out" class
        out_features[0]['mean'], out_features[0]['std'],
        out_features[1]['mean'], out_features[1]['std'],
        out_features[2]['mean'], out_features[2]['std'],
        out_features[3]['mean'], out_features[3]['std'],
        out_features[4]['mean'], out_features[4]['std'],
        out_features[5]['mean'], out_features[5]['std'],
        out_features[6]['mean'], out_features[6]['std'],
    ))

    db.commit()


def train_model(db_path: Path, min_samples: int = 10) -> ModelParams:
    """
    Train Gaussian Naive Bayes model from user annotations.

    Steps:
    1. Load layout configuration
    2. Query user annotations from full_frame_box_labels
    3. Join with full_frame_ocr to get box coordinates
    4. Extract 7 features for each labeled box
    5. Train Gaussian Naive Bayes model
    6. Save model parameters to box_classification_model table

    Args:
        db_path: Path to annotations database
        min_samples: Minimum number of annotations required to train

    Returns:
        Trained model parameters

    Raises:
        ValueError: If insufficient training data or layout config missing
    """
    db = sqlite3.connect(str(db_path))

    try:
        # Load layout config
        layout_config = get_layout_config(db)

        # Load training data
        features, labels = load_training_data(db, layout_config)

        # Check minimum samples
        if len(labels) < min_samples:
            raise ValueError(
                f'Insufficient training data: {len(labels)} samples '
                f'(minimum {min_samples} required)'
            )

        # Train model
        model = train_gaussian_naive_bayes(features, labels)

        # Save to database
        save_model_to_db(db, model)

        return model

    finally:
        db.close()
