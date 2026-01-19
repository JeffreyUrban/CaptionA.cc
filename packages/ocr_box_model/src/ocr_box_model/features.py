"""Feature extraction for OCR box classification.

Extracts 26 features from OCR bounding boxes for use in the
Gaussian Naive Bayes classifier.

Feature categories:
- Features 1-7: Spatial features (alignment, clustering, aspect ratio, position, area)
- Features 8-9: User annotations (binary indicators for "in" and "out" labels)
- Features 10-13: Edge positions (normalized left, top, right, bottom in [0-1] range)
- Features 14-24: Character sets (11 binary indicators, non-exclusive)
- Features 25-26: Temporal features (time from start and end in seconds)
"""

import sqlite3
from typing import Callable

from ocr_box_model.charset import detect_character_sets
from ocr_box_model.config import NUM_FEATURES
from ocr_box_model.knn import (
    compute_horizontal_clustering_score,
    compute_knn_alignment_score,
    filter_current_box,
    get_k_for_boxes,
)
from ocr_box_model.types import BoxBounds, VideoLayoutConfig


def query_user_annotation(
    conn: sqlite3.Connection | None,
    frame_index: int,
    box_index: int,
) -> tuple[float, float]:
    """Query user annotation from database for a box.

    Args:
        conn: SQLite database connection (or None)
        frame_index: Frame index
        box_index: Box index

    Returns:
        Tuple of (is_in, is_out) as floats (0.0 or 1.0)
    """
    if conn is None:
        return (0.0, 0.0)

    try:
        cursor = conn.cursor()
        result = cursor.execute(
            """
            SELECT label
            FROM full_frame_box_labels
            WHERE annotation_source = 'full_frame'
              AND frame_index = ?
              AND box_index = ?
              AND label_source = 'user'
            """,
            (frame_index, box_index),
        ).fetchone()

        if not result:
            return (0.0, 0.0)

        label = result[0]
        return (1.0, 0.0) if label == "in" else (0.0, 1.0)

    except Exception:
        return (0.0, 0.0)


def extract_features(
    box: BoxBounds,
    frame_width: int,
    frame_height: int,
    all_boxes: list[BoxBounds],
    timestamp_seconds: float,
    duration_seconds: float,
    conn: sqlite3.Connection | None = None,
) -> list[float]:
    """Extract 26 features from a box for Bayesian classification.

    All spatial features use k-nearest neighbors approach, independent of
    pre-computed cluster parameters to avoid circular dependencies.

    Args:
        box: Box bounds in top-referenced coordinates
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        all_boxes: All boxes for k-nn comparison
        timestamp_seconds: Timestamp in seconds
        duration_seconds: Video duration in seconds
        conn: SQLite database connection (optional)

    Returns:
        List of 26 feature values
    """
    box_width = box.right - box.left
    box_height = box.bottom - box.top
    box_center_x = (box.left + box.right) / 2
    box_center_y = (box.top + box.bottom) / 2
    box_area = box_width * box_height
    frame_area = frame_width * frame_height

    # K-nearest neighbors parameter
    k = get_k_for_boxes(len(all_boxes))

    # Filter out the current box from all_boxes
    other_boxes = filter_current_box(all_boxes, box)

    # Features 1-2: Vertical alignment scores (top and bottom edges)
    top_alignment_score = compute_knn_alignment_score(
        other_boxes,
        k,
        lambda b: abs(b.top - box.top),
        lambda b: b.top,
        box.top,
    )
    bottom_alignment_score = compute_knn_alignment_score(
        other_boxes,
        k,
        lambda b: abs(b.bottom - box.bottom),
        lambda b: b.bottom,
        box.bottom,
    )

    # Feature 3: Height similarity (among vertically-aligned neighbors)
    height_similarity_score = compute_knn_alignment_score(
        other_boxes,
        k,
        lambda b: abs(b.bottom - box.bottom),
        lambda b: b.bottom - b.top,
        box_height,
    )

    # Feature 4: Horizontal clustering
    horizontal_clustering_score = compute_horizontal_clustering_score(
        other_boxes, k, box_center_x, box.bottom
    )

    # Features 5-7: Simple spatial features
    aspect_ratio = box_width / box_height if box_height > 0 else 0.0
    normalized_y_position = box_center_y / frame_height if frame_height > 0 else 0.0
    normalized_area = box_area / frame_area if frame_area > 0 else 0.0

    # Features 8-9: User annotations (binary indicators)
    is_user_annotated_in, is_user_annotated_out = query_user_annotation(
        conn, box.frame_index, box.box_index
    )

    # Features 10-13: Edge positions (normalized to [0-1] range)
    normalized_left = box.left / frame_width if frame_width > 0 else 0.0
    normalized_top = box.top / frame_height if frame_height > 0 else 0.0
    normalized_right = box.right / frame_width if frame_width > 0 else 0.0
    normalized_bottom = box.bottom / frame_height if frame_height > 0 else 0.0

    # Features 14-24: Character sets (11 binary indicators, non-exclusive)
    char_sets = detect_character_sets(box.text)

    # Features 25-26: Temporal features
    time_from_start = timestamp_seconds
    time_from_end = duration_seconds - timestamp_seconds

    return [
        # Features 1-7: Spatial
        top_alignment_score,
        bottom_alignment_score,
        height_similarity_score,
        horizontal_clustering_score,
        aspect_ratio,
        normalized_y_position,
        normalized_area,
        # Features 8-9: User annotations
        is_user_annotated_in,
        is_user_annotated_out,
        # Features 10-13: Edge positions
        normalized_left,
        normalized_top,
        normalized_right,
        normalized_bottom,
        # Features 14-24: Character sets (11 features)
        char_sets.is_roman,
        char_sets.is_hanzi,
        char_sets.is_arabic,
        char_sets.is_korean,
        char_sets.is_hiragana,
        char_sets.is_katakana,
        char_sets.is_cyrillic,
        char_sets.is_devanagari,
        char_sets.is_thai,
        char_sets.is_digits,
        char_sets.is_punctuation,
        # Features 25-26: Temporal
        time_from_start,
        time_from_end,
    ]


def extract_features_from_layout(
    box: BoxBounds,
    layout: VideoLayoutConfig,
    all_boxes: list[BoxBounds],
    timestamp_seconds: float,
    duration_seconds: float,
    conn: sqlite3.Connection | None = None,
) -> list[float]:
    """Extract features using VideoLayoutConfig for convenience.

    Args:
        box: Box bounds in top-referenced coordinates
        layout: Video layout configuration
        all_boxes: All boxes for k-nn comparison
        timestamp_seconds: Timestamp in seconds
        duration_seconds: Video duration in seconds
        conn: SQLite database connection (optional)

    Returns:
        List of 26 feature values
    """
    return extract_features(
        box=box,
        frame_width=layout.frame_width,
        frame_height=layout.frame_height,
        all_boxes=all_boxes,
        timestamp_seconds=timestamp_seconds,
        duration_seconds=duration_seconds,
        conn=conn,
    )


def extract_features_batch(
    boxes: list[BoxBounds],
    frame_width: int,
    frame_height: int,
    all_boxes: list[BoxBounds],
    timestamp_seconds: float,
    duration_seconds: float,
    conn: sqlite3.Connection | None = None,
) -> list[list[float]]:
    """Extract features from multiple OCR boxes.

    Args:
        boxes: List of bounding boxes
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        all_boxes: All boxes for k-nn comparison
        timestamp_seconds: Timestamp in seconds
        duration_seconds: Video duration in seconds
        conn: SQLite database connection (optional)

    Returns:
        List of feature vectors, one per box
    """
    return [
        extract_features(
            box=box,
            frame_width=frame_width,
            frame_height=frame_height,
            all_boxes=all_boxes,
            timestamp_seconds=timestamp_seconds,
            duration_seconds=duration_seconds,
            conn=conn,
        )
        for box in boxes
    ]


def validate_features(features: list[float]) -> bool:
    """Validate that a feature vector has the correct length.

    Args:
        features: Feature vector to validate

    Returns:
        True if valid, False otherwise
    """
    return len(features) == NUM_FEATURES
