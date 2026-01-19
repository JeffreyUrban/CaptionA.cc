"""Model training for OCR box classification.

Trains Gaussian Naive Bayes model using user annotations.
"""

import logging
import sqlite3
from dataclasses import dataclass
from typing import Literal

from ocr_box_model.config import MIN_ANNOTATIONS_FOR_RETRAIN, MIN_STD, NUM_FEATURES
from ocr_box_model.db import (
    get_video_duration,
    load_layout_config,
    run_all_migrations,
    save_model,
)
from ocr_box_model.features import extract_features
from ocr_box_model.types import (
    BoxBounds,
    ClassSamples,
    GaussianParams,
    ModelParams,
    SEED_IN_PARAMS,
    SEED_OUT_PARAMS,
    VideoLayoutConfig,
)

logger = logging.getLogger(__name__)


@dataclass
class AnnotationRow:
    """Annotation row from the database."""

    label: Literal["in", "out"]
    box_left: int
    box_top: int
    box_right: int
    box_bottom: int
    frame_index: int
    box_index: int


@dataclass
class FrameDataCache:
    """Cache for frame data to avoid repeated queries."""

    boxes_cache: dict[int, list[BoxBounds]]
    text_cache: dict[str, str]
    timestamp_cache: dict[int, float]


def fetch_user_annotations(conn: sqlite3.Connection) -> list[AnnotationRow]:
    """Fetch user annotations from database.

    Args:
        conn: SQLite database connection

    Returns:
        List of annotation rows
    """
    cursor = conn.cursor()
    rows = cursor.execute(
        """
        SELECT
            label,
            box_left,
            box_top,
            box_right,
            box_bottom,
            frame_index,
            box_index
        FROM full_frame_box_labels
        WHERE label_source = 'user'
        ORDER BY frame_index
        """
    ).fetchall()

    return [
        AnnotationRow(
            label=row[0],
            box_left=row[1],
            box_top=row[2],
            box_right=row[3],
            box_bottom=row[4],
            frame_index=row[5],
            box_index=row[6],
        )
        for row in rows
    ]


def build_frame_data_cache(
    conn: sqlite3.Connection,
    frame_index: int,
    layout: VideoLayoutConfig,
    cache: FrameDataCache,
) -> None:
    """Build frame data cache for efficient feature extraction.

    Args:
        conn: SQLite database connection
        frame_index: Frame index to cache
        layout: Video layout configuration
        cache: Cache to populate
    """
    if frame_index in cache.boxes_cache:
        return

    cursor = conn.cursor()
    rows = cursor.execute(
        """
        SELECT box_index, text, timestamp_seconds, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
        """,
        (frame_index,),
    ).fetchall()

    # Cache box bounds
    box_bounds = []
    for row in rows:
        box_index, text, timestamp_seconds, x, y, width, height = row

        # Convert normalized coordinates to pixels
        left = int(x * layout.frame_width)
        bottom = int((1 - y) * layout.frame_height)
        box_width = int(width * layout.frame_width)
        box_height = int(height * layout.frame_height)
        top = bottom - box_height
        right = left + box_width

        box_bounds.append(
            BoxBounds(
                left=left,
                top=top,
                right=right,
                bottom=bottom,
                frame_index=frame_index,
                box_index=box_index,
                text=text or "",
            )
        )

        # Cache text
        cache.text_cache[f"{frame_index}-{box_index}"] = text or ""

    cache.boxes_cache[frame_index] = box_bounds

    # Cache timestamp from first box
    if rows:
        cache.timestamp_cache[frame_index] = rows[0][2] or 0.0


def extract_all_features(
    conn: sqlite3.Connection,
    annotations: list[AnnotationRow],
    layout: VideoLayoutConfig,
    duration_seconds: float,
) -> tuple[list[list[float]], list[list[float]]]:
    """Extract features for all annotations and separate by class.

    Args:
        conn: SQLite database connection
        annotations: List of annotations
        layout: Video layout configuration
        duration_seconds: Video duration in seconds

    Returns:
        Tuple of (in_features, out_features)
    """
    cache = FrameDataCache(
        boxes_cache={},
        text_cache={},
        timestamp_cache={},
    )

    in_features: list[list[float]] = []
    out_features: list[list[float]] = []

    for ann in annotations:
        build_frame_data_cache(conn, ann.frame_index, layout, cache)

        all_boxes = cache.boxes_cache.get(ann.frame_index, [])
        box_bounds = BoxBounds(
            left=ann.box_left,
            top=ann.box_top,
            right=ann.box_right,
            bottom=ann.box_bottom,
            frame_index=ann.frame_index,
            box_index=ann.box_index,
            text=cache.text_cache.get(f"{ann.frame_index}-{ann.box_index}", ""),
        )

        timestamp_seconds = cache.timestamp_cache.get(ann.frame_index, 0.0)

        features = extract_features(
            box=box_bounds,
            frame_width=layout.frame_width,
            frame_height=layout.frame_height,
            all_boxes=all_boxes,
            timestamp_seconds=timestamp_seconds,
            duration_seconds=duration_seconds,
            conn=conn,
        )

        if ann.label == "in":
            in_features.append(features)
        else:
            out_features.append(features)

    return in_features, out_features


def calculate_gaussian_params(
    in_features: list[list[float]],
    out_features: list[list[float]],
) -> tuple[list[GaussianParams], list[GaussianParams]]:
    """Calculate Gaussian parameters for all 26 features.

    Args:
        in_features: Feature vectors for "in" class
        out_features: Feature vectors for "out" class

    Returns:
        Tuple of (in_params, out_params)
    """
    in_params: list[GaussianParams] = []
    out_params: list[GaussianParams] = []

    for i in range(NUM_FEATURES):
        # Calculate in-class parameters
        in_values = [f[i] for f in in_features]
        in_mean = sum(in_values) / len(in_values) if in_values else 0.0
        in_variance = (
            sum((v - in_mean) ** 2 for v in in_values) / len(in_values)
            if in_values
            else 0.0
        )
        in_std = max((in_variance**0.5), MIN_STD)
        in_params.append(GaussianParams(mean=in_mean, std=in_std))

        # Calculate out-class parameters
        out_values = [f[i] for f in out_features]
        out_mean = sum(out_values) / len(out_values) if out_values else 0.0
        out_variance = (
            sum((v - out_mean) ** 2 for v in out_values) / len(out_values)
            if out_values
            else 0.0
        )
        out_std = max((out_variance**0.5), MIN_STD)
        out_params.append(GaussianParams(mean=out_mean, std=out_std))

    return in_params, out_params


def train_model(
    conn: sqlite3.Connection,
    layout: VideoLayoutConfig | None = None,
) -> int | None:
    """Train Bayesian model using user annotations.

    Fetches all user-labeled boxes, extracts features, calculates Gaussian
    parameters, and stores in database.

    Args:
        conn: SQLite database connection
        layout: Video layout configuration (loaded from DB if not provided)

    Returns:
        Number of training samples used, or None if insufficient data
    """
    run_all_migrations(conn)

    # Load layout if not provided
    if layout is None:
        layout = load_layout_config(conn)
        if layout is None:
            logger.error("No layout configuration found")
            return None

    # Fetch annotations
    annotations = fetch_user_annotations(conn)

    if len(annotations) < MIN_ANNOTATIONS_FOR_RETRAIN:
        logger.info(
            f"Insufficient training data: {len(annotations)} samples "
            f"(need {MIN_ANNOTATIONS_FOR_RETRAIN}+)"
        )

        # Check if we need to reset to seed model
        cursor = conn.cursor()
        result = cursor.execute(
            "SELECT n_training_samples FROM box_classification_model WHERE id = 1"
        ).fetchone()

        if result and result[0] >= MIN_ANNOTATIONS_FOR_RETRAIN:
            logger.info("Resetting to seed model (annotations cleared)")
            cursor.execute("DELETE FROM box_classification_model WHERE id = 1")
            conn.commit()

        return None

    logger.info(f"Training with {len(annotations)} user annotations")

    # Get video duration
    duration_seconds = get_video_duration(conn)

    # Extract features
    in_features, out_features = extract_all_features(
        conn, annotations, layout, duration_seconds
    )

    # Need at least 2 samples per class
    if len(in_features) < 2 or len(out_features) < 2:
        logger.info(
            f"Insufficient samples per class: in={len(in_features)}, out={len(out_features)}"
        )
        return None

    # Calculate Gaussian parameters
    in_params, out_params = calculate_gaussian_params(in_features, out_features)

    # Calculate priors
    total = len(annotations)
    prior_in = len(in_features) / total
    prior_out = len(out_features) / total

    # Calculate feature importance and covariance (imported from feature_importance module)
    feature_importance = None
    covariance_matrix = None
    covariance_inverse = None

    try:
        from ocr_box_model.feature_importance import (
            calculate_feature_importance,
            compute_pooled_covariance,
            invert_covariance_matrix,
            should_calculate_feature_importance,
        )

        if should_calculate_feature_importance(total):
            feature_importance = calculate_feature_importance(in_params, out_params)
            logger.info(
                f"Calculated feature importance (top 5): "
                + ", ".join(
                    f"{f.feature_name}={f.fisher_score:.2f}"
                    for f in sorted(feature_importance, key=lambda x: -x.fisher_score)[:5]
                )
            )

        if len(in_features) >= 2 and len(out_features) >= 2:
            in_samples = ClassSamples(n=len(in_features), features=in_features)
            out_samples = ClassSamples(n=len(out_features), features=out_features)

            covariance_matrix = compute_pooled_covariance(in_samples, out_samples)
            covariance_inverse = invert_covariance_matrix(covariance_matrix)
            logger.info("Computed pooled covariance matrix (26x26)")

    except ImportError:
        logger.warning("Feature importance module not available")

    # Create model
    model = ModelParams(
        model_version="naive_bayes_v2",
        n_training_samples=total,
        prior_in=prior_in,
        prior_out=prior_out,
        in_features=in_params,
        out_features=out_params,
        feature_importance=feature_importance,
        covariance_matrix=covariance_matrix,
        covariance_inverse=covariance_inverse,
    )

    # Save model
    save_model(conn, model)

    logger.info(f"Model trained: {len(in_features)} 'in', {len(out_features)} 'out'")
    return total


def initialize_seed_model(conn: sqlite3.Connection) -> None:
    """Initialize seed model with typical caption layout parameters.

    Provides reasonable starting predictions before user annotations.

    Args:
        conn: SQLite database connection
    """
    run_all_migrations(conn)

    # Check if model exists
    cursor = conn.cursor()
    result = cursor.execute(
        "SELECT id FROM box_classification_model WHERE id = 1"
    ).fetchone()

    if result:
        logger.info("Model already exists, skipping seed initialization")
        return

    logger.info("Initializing seed model with typical caption parameters")

    model = ModelParams(
        model_version="seed_v2",
        n_training_samples=0,
        prior_in=0.5,
        prior_out=0.5,
        in_features=SEED_IN_PARAMS,
        out_features=SEED_OUT_PARAMS,
    )

    save_model(conn, model)
    logger.info("Seed model initialized successfully")


def get_training_samples(
    conn: sqlite3.Connection,
) -> tuple[ClassSamples, ClassSamples] | None:
    """Get training samples for streaming update calculations.

    Args:
        conn: SQLite database connection

    Returns:
        Tuple of (in_samples, out_samples) or None if insufficient data
    """
    layout = load_layout_config(conn)
    if layout is None:
        return None

    annotations = fetch_user_annotations(conn)
    if len(annotations) < MIN_ANNOTATIONS_FOR_RETRAIN:
        return None

    duration_seconds = get_video_duration(conn)
    in_features, out_features = extract_all_features(
        conn, annotations, layout, duration_seconds
    )

    if len(in_features) < 2 or len(out_features) < 2:
        return None

    return (
        ClassSamples(n=len(in_features), features=in_features),
        ClassSamples(n=len(out_features), features=out_features),
    )
