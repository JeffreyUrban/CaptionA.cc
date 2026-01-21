"""K-nearest neighbors functions for spatial feature extraction.

Computes alignment and clustering scores using k-nearest neighbors
approach, independent of pre-computed cluster parameters.
"""

import math
from typing import Callable

from ocr_box_model.types import BoxBounds


def compute_knn_alignment_score(
    other_boxes: list[BoxBounds],
    k: int,
    distance_fn: Callable[[BoxBounds], float],
    value_fn: Callable[[BoxBounds], float],
    current_value: float,
) -> float:
    """Compute k-nearest-neighbors alignment score.

    Returns deviation from neighbor mean in standard deviation units.
    Lower score indicates better alignment with neighbors.

    Args:
        other_boxes: Boxes to compare against (excluding current box)
        k: Number of nearest neighbors to use
        distance_fn: Function to compute distance from current box
        value_fn: Function to extract the value to compare from neighbor
        current_value: The value from the current box to compare against neighbor mean

    Returns:
        Standard deviation units from neighbor mean
    """
    if len(other_boxes) == 0:
        return 0.0

    # Sort by distance and take k nearest
    sorted_boxes = sorted(
        [(box, distance_fn(box)) for box in other_boxes],
        key=lambda x: x[1],
    )
    nearest = sorted_boxes[: min(k, len(other_boxes))]

    if len(nearest) <= 1:
        return 0.0

    # Extract values from nearest neighbors
    values = [value_fn(box) for box, _ in nearest]
    mean = sum(values) / len(values)
    variance = sum((val - mean) ** 2 for val in values) / len(values)
    std = math.sqrt(variance)

    return abs(current_value - mean) / std if std > 0 else 0.0


def compute_horizontal_clustering_score(
    other_boxes: list[BoxBounds],
    k: int,
    box_center_x: float,
    box_bottom: int,
) -> float:
    """Compute horizontal clustering score using weighted distance.

    Combines vertical and horizontal distance with configurable weights.
    Lower score indicates box is well-clustered with neighbors.

    Args:
        other_boxes: Boxes to compare against (excluding current box)
        k: Number of nearest neighbors to use
        box_center_x: Center X coordinate of current box
        box_bottom: Bottom Y coordinate of current box

    Returns:
        Standard deviation units from neighbor mean center X
    """
    if len(other_boxes) == 0:
        return 0.0

    vertical_weight = 0.7
    horizontal_weight = 0.3

    # Calculate combined distance for each box
    sorted_boxes: list[tuple[float, float]] = []
    for box in other_boxes:
        b_center_x = (box.left + box.right) / 2
        vertical_dist = abs(box.bottom - box_bottom)
        horizontal_dist = abs(b_center_x - box_center_x)
        combined_dist = vertical_weight * vertical_dist + horizontal_weight * horizontal_dist
        sorted_boxes.append((b_center_x, combined_dist))

    # Sort by combined distance and take k nearest
    sorted_boxes.sort(key=lambda x: x[1])
    nearest = sorted_boxes[: min(k, len(other_boxes))]

    if len(nearest) <= 1:
        return 0.0

    # Calculate mean and std of center X values
    center_xs = [center_x for center_x, _ in nearest]
    mean = sum(center_xs) / len(center_xs)
    variance = sum((x - mean) ** 2 for x in center_xs) / len(center_xs)
    std = math.sqrt(variance)

    return abs(box_center_x - mean) / std if std > 0 else 0.0


def get_k_for_boxes(num_boxes: int) -> int:
    """Calculate k value for KNN based on number of boxes.

    Uses ceiling of 20% of total boxes, minimum 5.

    Args:
        num_boxes: Total number of boxes

    Returns:
        k value to use for KNN
    """
    return max(5, math.ceil(num_boxes * 0.2))


def filter_current_box(all_boxes: list[BoxBounds], current_box: BoxBounds) -> list[BoxBounds]:
    """Filter out the current box from the list of all boxes.

    Args:
        all_boxes: All boxes in the frame
        current_box: The box to exclude

    Returns:
        List of boxes excluding the current box
    """
    return [
        b
        for b in all_boxes
        if not (
            b.left == current_box.left
            and b.top == current_box.top
            and b.right == current_box.right
            and b.bottom == current_box.bottom
        )
    ]
