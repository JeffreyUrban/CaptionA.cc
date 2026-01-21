"""
Layout analysis service for Bayesian analysis of OCR boxes.

This module provides API-specific layout analysis functions that build on
the ocr_box_model package's feature extraction capabilities.
"""

import logging
import sqlite3
from typing import Literal

from ocr_box_model import (
    BoxBounds,
    LayoutParams,
    load_all_boxes as _load_all_boxes,
)
from ocr_box_model.math_utils import calculate_mode, calculate_std, filter_outliers

logger = logging.getLogger(__name__)


def load_all_boxes(
    conn: sqlite3.Connection, frame_width: int, frame_height: int
) -> list[BoxBounds]:
    """
    Load all OCR boxes from database and convert to top-referenced coordinates.

    Args:
        conn: SQLite database connection
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels

    Returns:
        List of BoxBounds in top-referenced coordinate system
    """
    return _load_all_boxes(conn, frame_height)


def determine_anchor_type(
    boxes: list[BoxBounds],
    frame_width: int,
    vertical_position: float,
    vertical_std: float,
    box_width: float,
) -> tuple[Literal["left", "center", "right"], int]:
    """
    Determine anchor type and position based on horizontal distribution of boxes.

    Analyzes horizontal distribution of boxes to determine if captions are:
    - left-aligned (strong left edge)
    - right-aligned (strong right edge)
    - center-aligned (balanced edges, center of mass near frame center)

    Args:
        boxes: All boxes in top-referenced coordinates
        frame_width: Frame width in pixels
        vertical_position: Vertical center position (mode of center_y)
        vertical_std: Standard deviation of center_y
        box_width: Typical box width (mode)

    Returns:
        Tuple of (anchor_type, anchor_position)
    """
    # Filter boxes near vertical center line
    relevant_boxes = [
        box
        for box in boxes
        if abs((box.top + box.bottom) / 2 - vertical_position) < vertical_std * 2
    ]

    if not relevant_boxes:
        return ("center", frame_width // 2)

    # Calculate horizontal density
    density = [0] * frame_width
    for box in relevant_boxes:
        for x in range(max(0, box.left), min(frame_width, box.right + 1)):
            density[x] += 1

    # Calculate derivatives to find edges
    derivatives = [density[i + 1] - density[i] for i in range(frame_width - 1)]

    # Find max positive derivative (left edge where density increases)
    max_positive_derivative = 0.0
    positive_edge_pos = 0
    for i, deriv in enumerate(derivatives):
        if deriv > max_positive_derivative:
            max_positive_derivative = deriv
            positive_edge_pos = i

    # Find max negative derivative (right edge where density decreases)
    max_negative_derivative = 0.0
    negative_edge_pos = frame_width - 1
    for i, deriv in enumerate(derivatives):
        if deriv < max_negative_derivative:
            max_negative_derivative = deriv
            negative_edge_pos = i

    # Calculate center of mass
    center_x_values = [(box.left + box.right) / 2 for box in relevant_boxes]
    mean_center_x = sum(center_x_values) / len(center_x_values)
    frame_center_x = frame_width / 2

    # Determine anchor type based on edge strengths and center of mass
    center_of_mass_near_frame_center = (
        abs(mean_center_x - frame_center_x) < box_width * 1.0
    )
    left_edge_strength = max_positive_derivative
    right_edge_strength = abs(max_negative_derivative)

    anchor_type: Literal["left", "center", "right"]
    if (
        center_of_mass_near_frame_center
        and abs(left_edge_strength - right_edge_strength) < left_edge_strength * 0.3
    ):
        anchor_type = "center"
        anchor_position = round(mean_center_x)
    elif left_edge_strength > right_edge_strength * 1.2:
        anchor_type = "left"
        anchor_position = positive_edge_pos
    elif right_edge_strength > left_edge_strength * 1.2:
        anchor_type = "right"
        anchor_position = negative_edge_pos
    else:
        if left_edge_strength >= right_edge_strength:
            anchor_type = "left"
            anchor_position = positive_edge_pos
        else:
            anchor_type = "right"
            anchor_position = negative_edge_pos

    return (anchor_type, anchor_position)


def analyze_ocr_boxes(
    conn: sqlite3.Connection, frame_width: int, frame_height: int
) -> LayoutParams:
    """
    Analyze OCR boxes to determine optimal layout parameters.

    Uses feature extraction and statistical analysis to determine:
    - Vertical position of caption center
    - Box height (typical height of caption boxes)
    - Anchor type (left/center/right alignment)
    - Anchor position (X coordinate of alignment)
    - Edge standard deviations (for boundary detection)

    Args:
        conn: SQLite database connection to layout.db
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels

    Returns:
        Layout parameters for caption region

    Raises:
        ValueError: If no OCR boxes found in database
    """
    # Load all boxes and convert to top-referenced coordinates
    boxes = load_all_boxes(conn, frame_width, frame_height)

    if len(boxes) == 0:
        raise ValueError("No OCR boxes found in video")

    logger.info(f"Loaded {len(boxes)} boxes for analysis")

    # Calculate statistics from box positions
    center_y_values = [(box.top + box.bottom) / 2 for box in boxes]
    height_values = [float(box.bottom - box.top) for box in boxes]
    width_values = [float(box.right - box.left) for box in boxes]
    top_edges = [float(box.top) for box in boxes]
    bottom_edges = [float(box.bottom) for box in boxes]
    left_edges = [float(box.left) for box in boxes]
    right_edges = [float(box.right) for box in boxes]

    # Filter horizontal outliers
    left_edges = filter_outliers(left_edges)
    right_edges = filter_outliers(right_edges)

    # Calculate modes and standard deviations
    vertical_position = calculate_mode(center_y_values, bin_size=5)
    vertical_std = calculate_std(center_y_values, vertical_position)
    box_height = calculate_mode(height_values, bin_size=2)
    box_height_std = calculate_std(height_values, box_height)
    box_width = calculate_mode(width_values, bin_size=2)

    logger.info(
        f"Calculated vertical_position={vertical_position:.1f}, "
        f"vertical_std={vertical_std:.1f}, "
        f"box_height={box_height:.1f}, "
        f"box_width={box_width:.1f}"
    )

    # Calculate edge standard deviations
    top_mode = calculate_mode(top_edges, bin_size=5)
    top_edges_filtered = [val for val in top_edges if abs(val - top_mode) < 100]
    top_edge_std = calculate_std(top_edges_filtered, top_mode)

    bottom_mode = calculate_mode(bottom_edges, bin_size=5)
    bottom_edges_filtered = [
        val for val in bottom_edges if abs(val - bottom_mode) < 100
    ]
    bottom_edge_std = calculate_std(bottom_edges_filtered, bottom_mode)

    # Determine anchor type and position
    anchor_type, anchor_position = determine_anchor_type(
        boxes, frame_width, vertical_position, vertical_std, box_width
    )

    logger.info(
        f"Determined anchor_type={anchor_type}, anchor_position={anchor_position}"
    )

    return LayoutParams(
        vertical_position=int(vertical_position),
        vertical_std=vertical_std,
        box_height=int(box_height),
        box_height_std=box_height_std,
        anchor_type=anchor_type,
        anchor_position=anchor_position,
        top_edge_std=top_edge_std,
        bottom_edge_std=bottom_edge_std,
    )


def update_layout_config(conn: sqlite3.Connection, params: LayoutParams) -> None:
    """
    Update layout config table with analyzed parameters.

    Args:
        conn: SQLite database connection
        params: Layout parameters to save
    """
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE layout_config
        SET vertical_center = ?,
            anchor_type = ?,
            anchor_position = ?,
            updated_at = datetime('now')
        WHERE id = 1
        """,
        (
            params.vertical_position,
            params.anchor_type,
            params.anchor_position,
        ),
    )
    conn.commit()

    logger.info(f"Updated layout config with {params.anchor_type} anchor")
