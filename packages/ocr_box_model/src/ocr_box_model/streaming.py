"""Streaming prediction updates with intelligent scope detection.

Provides continuous, non-blocking prediction updates after each annotation
instead of batch recalculation every 20 annotations.
"""

import logging
import math
from typing import Callable, TypeVar

from ocr_box_model.config import (
    BATCH_SIZE,
    BOUNDARY_SENSITIVITY_WEIGHT,
    MAX_BOXES_PER_UPDATE,
    MAX_MAHALANOBIS_DISTANCE,
    MIN_BOXES_BEFORE_CHECK,
    MIN_CHANGE_PROBABILITY,
    REVERSAL_WINDOW_SIZE,
    SIMILARITY_WEIGHT,
    TARGET_REVERSAL_RATE,
    UNCERTAINTY_WEIGHT,
)
from ocr_box_model.feature_importance import compute_mahalanobis_distance
from ocr_box_model.types import (
    AdaptiveRecalcResult,
    Annotation,
    BoxWithPrediction,
    Prediction,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


def chunk(array: list[T], size: int) -> list[list[T]]:
    """Chunk array into batches of specified size.

    Args:
        array: Array to chunk
        size: Batch size

    Returns:
        Array of batches
    """
    chunks: list[list[T]] = []
    for i in range(0, len(array), size):
        chunks.append(array[i : i + size])
    return chunks


def estimate_prediction_change_prob(
    box: BoxWithPrediction,
    new_annotation: Annotation,
    covariance_inverse: list[float],
) -> float:
    """Estimate probability that a box's prediction will change after model update.

    Combines three factors:
    1. Current prediction uncertainty (low confidence -> high change probability)
    2. Feature similarity to new annotation (weighted by Mahalanobis distance)
    3. Distance to decision boundary (near boundary -> high change probability)

    Args:
        box: Box with current prediction and features
        new_annotation: Newly annotated box
        covariance_inverse: Inverse pooled covariance matrix (676 values)

    Returns:
        Probability in [0, 1] that prediction will flip
    """
    # Factor 1: Uncertainty (inverse of confidence)
    uncertainty_factor = 1.0 - box.current_prediction.confidence

    # Factor 2: Weighted feature similarity using Mahalanobis distance
    mahalanobis_distance = compute_mahalanobis_distance(
        box.features,
        new_annotation.features,
        covariance_inverse,
    )

    # Convert distance to similarity [0-1] using exponential decay
    sigma = MAX_MAHALANOBIS_DISTANCE
    similarity_factor = math.exp(-(mahalanobis_distance**2) / (2 * sigma**2))

    # Factor 3: Decision boundary proximity
    # Boxes with confidence near 0.5 are on the decision boundary
    boundary_proximity = 1.0 - abs(box.current_prediction.confidence - 0.5) * 2

    # Weighted combination
    change_prob = (
        uncertainty_factor * UNCERTAINTY_WEIGHT
        + similarity_factor * SIMILARITY_WEIGHT
        + boundary_proximity * BOUNDARY_SENSITIVITY_WEIGHT
    )

    # Clamp to [0, 1]
    return min(1.0, max(0.0, change_prob))


def identify_affected_boxes(
    new_annotation: Annotation,
    all_boxes: list[BoxWithPrediction],
    covariance_inverse: list[float],
) -> list[tuple[BoxWithPrediction, float]]:
    """Identify boxes that should be recalculated after annotation.

    Returns boxes sorted by change probability (highest first).

    Args:
        new_annotation: Newly annotated box
        all_boxes: All boxes in video
        covariance_inverse: Inverse pooled covariance matrix

    Returns:
        List of (box, change_prob) tuples with change_prob >= MIN_CHANGE_PROBABILITY
    """
    # Compute change probability for all boxes
    boxes_with_prob: list[tuple[BoxWithPrediction, float]] = []
    for box in all_boxes:
        change_prob = estimate_prediction_change_prob(
            box, new_annotation, covariance_inverse
        )
        if change_prob >= MIN_CHANGE_PROBABILITY:
            boxes_with_prob.append((box, change_prob))

    # Sort by change probability (highest first)
    boxes_with_prob.sort(key=lambda x: -x[1])

    return boxes_with_prob


async def adaptive_recalculation(
    candidates: list[tuple[BoxWithPrediction, float]],
    predict_and_update: Callable[
        [list[tuple[BoxWithPrediction, float]]],
        list[tuple[BoxWithPrediction, str, str, bool]],
    ],
) -> AdaptiveRecalcResult:
    """Adaptive recalculation coordinator.

    Processes boxes in order of change probability, stopping when reversal rate
    drops below threshold.

    Note: This is the async version. For synchronous use, use adaptive_recalculation_sync.

    Args:
        candidates: Boxes sorted by change probability (box, prob) tuples
        predict_and_update: Function to recalculate prediction and update DB.
            Returns list of (box, old_label, new_label, did_reverse) tuples.

    Returns:
        Recalculation statistics
    """
    import asyncio

    reversal_window: list[bool] = []
    total_processed = 0
    total_reversals = 0

    # Process in batches
    for i in range(0, min(len(candidates), MAX_BOXES_PER_UPDATE), BATCH_SIZE):
        batch = candidates[i : i + BATCH_SIZE]

        # Recalculate predictions for batch
        results = predict_and_update(batch)

        # Track reversals
        for _, _, _, did_reverse in results:
            reversal_window.append(did_reverse)
            if did_reverse:
                total_reversals += 1

            # Keep window size bounded
            if len(reversal_window) > REVERSAL_WINDOW_SIZE:
                removed = reversal_window.pop(0)
                if removed:
                    total_reversals -= 1

        total_processed += len(batch)

        # Check if we can stop early
        if (
            len(reversal_window) >= MIN_BOXES_BEFORE_CHECK
            and len(reversal_window) >= REVERSAL_WINDOW_SIZE
        ):
            rolling_reversal_rate = total_reversals / len(reversal_window)

            if rolling_reversal_rate < TARGET_REVERSAL_RATE:
                final_rate = total_reversals / len(reversal_window)
                logger.info(
                    f"Stopping early: reversal rate {rolling_reversal_rate:.3f} "
                    f"below target {TARGET_REVERSAL_RATE}"
                )

                return AdaptiveRecalcResult(
                    total_processed=total_processed,
                    total_reversals=total_reversals,
                    final_reversal_rate=final_rate,
                    stopped_early=True,
                    reason="reversal_rate",
                )

        # Yield to event loop for UI responsiveness
        await asyncio.sleep(0)

    # Determine why we stopped
    hit_max_boxes = total_processed >= MAX_BOXES_PER_UPDATE

    final_rate = (
        total_reversals / len(reversal_window)
        if reversal_window
        else total_reversals / max(1, total_processed)
    )

    return AdaptiveRecalcResult(
        total_processed=total_processed,
        total_reversals=total_reversals,
        final_reversal_rate=final_rate,
        stopped_early=False,
        reason="max_boxes" if hit_max_boxes else "exhausted_candidates",
    )


def adaptive_recalculation_sync(
    candidates: list[tuple[BoxWithPrediction, float]],
    predict_and_update: Callable[
        [list[tuple[BoxWithPrediction, float]]],
        list[tuple[BoxWithPrediction, str, str, bool]],
    ],
) -> AdaptiveRecalcResult:
    """Synchronous version of adaptive recalculation.

    Args:
        candidates: Boxes sorted by change probability (box, prob) tuples
        predict_and_update: Function to recalculate prediction and update DB.

    Returns:
        Recalculation statistics
    """
    reversal_window: list[bool] = []
    total_processed = 0
    total_reversals = 0

    # Process in batches
    for i in range(0, min(len(candidates), MAX_BOXES_PER_UPDATE), BATCH_SIZE):
        batch = candidates[i : i + BATCH_SIZE]

        # Recalculate predictions for batch
        results = predict_and_update(batch)

        # Track reversals
        for _, _, _, did_reverse in results:
            reversal_window.append(did_reverse)
            if did_reverse:
                total_reversals += 1

            # Keep window size bounded
            if len(reversal_window) > REVERSAL_WINDOW_SIZE:
                removed = reversal_window.pop(0)
                if removed:
                    total_reversals -= 1

        total_processed += len(batch)

        # Check if we can stop early
        if (
            len(reversal_window) >= MIN_BOXES_BEFORE_CHECK
            and len(reversal_window) >= REVERSAL_WINDOW_SIZE
        ):
            rolling_reversal_rate = total_reversals / len(reversal_window)

            if rolling_reversal_rate < TARGET_REVERSAL_RATE:
                final_rate = total_reversals / len(reversal_window)
                logger.info(
                    f"Stopping early: reversal rate {rolling_reversal_rate:.3f} "
                    f"below target {TARGET_REVERSAL_RATE}"
                )

                return AdaptiveRecalcResult(
                    total_processed=total_processed,
                    total_reversals=total_reversals,
                    final_reversal_rate=final_rate,
                    stopped_early=True,
                    reason="reversal_rate",
                )

    # Determine why we stopped
    hit_max_boxes = total_processed >= MAX_BOXES_PER_UPDATE

    final_rate = (
        total_reversals / len(reversal_window)
        if reversal_window
        else total_reversals / max(1, total_processed)
    )

    return AdaptiveRecalcResult(
        total_processed=total_processed,
        total_reversals=total_reversals,
        final_reversal_rate=final_rate,
        stopped_early=False,
        reason="max_boxes" if hit_max_boxes else "exhausted_candidates",
    )
