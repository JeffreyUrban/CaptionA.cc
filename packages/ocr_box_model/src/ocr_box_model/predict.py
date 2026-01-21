"""Bayesian prediction for OCR box classification.

Predicts whether a box is a caption ("in") or noise ("out") based on:
- Trained Gaussian Naive Bayes model (when available)
- Fallback heuristics based on layout parameters
"""

import logging
import math
import sqlite3

from ocr_box_model.config import NUM_FEATURES, PDF_FLOOR
from ocr_box_model.db import get_box_text_and_timestamp, get_video_duration, load_model
from ocr_box_model.features import extract_features
from ocr_box_model.math_utils import gaussian_pdf
from ocr_box_model.types import BoxBounds, ModelParams, Prediction, VideoLayoutConfig

logger = logging.getLogger(__name__)


def predict_bayesian(
    features: list[float],
    model: ModelParams,
) -> Prediction:
    """Predict label using Gaussian Naive Bayes model.

    Uses log-space arithmetic to prevent numerical underflow when
    multiplying many small probabilities.

    Args:
        features: 26-dimensional feature vector
        model: Trained model parameters

    Returns:
        Prediction with label and confidence
    """
    if len(features) != NUM_FEATURES:
        raise ValueError(f"Expected {NUM_FEATURES} features, got {len(features)}")

    # Calculate log-likelihoods using log-space
    log_likelihood_in = 0.0
    log_likelihood_out = 0.0

    for i in range(NUM_FEATURES):
        feature_value = features[i]
        in_feature = model.in_features[i]
        out_feature = model.out_features[i]

        pdf_in = gaussian_pdf(feature_value, in_feature.mean, in_feature.std)
        pdf_out = gaussian_pdf(feature_value, out_feature.mean, out_feature.std)

        # Add to log-likelihood (log of product is sum of logs)
        # Use max to avoid log(0) = -Infinity
        log_likelihood_in += math.log(max(pdf_in, PDF_FLOOR))
        log_likelihood_out += math.log(max(pdf_out, PDF_FLOOR))

    # Apply Bayes' theorem in log-space
    log_posterior_in = log_likelihood_in + math.log(model.prior_in)
    log_posterior_out = log_likelihood_out + math.log(model.prior_out)

    # Convert back from log-space using log-sum-exp trick
    max_log_posterior = max(log_posterior_in, log_posterior_out)
    posterior_in = math.exp(log_posterior_in - max_log_posterior)
    posterior_out = math.exp(log_posterior_out - max_log_posterior)
    total = posterior_in + posterior_out

    if total == 0 or not math.isfinite(total):
        # Degenerate case
        return Prediction(label="in", confidence=0.5)

    prob_in = posterior_in / total
    prob_out = posterior_out / total

    if prob_in > prob_out:
        return Prediction(label="in", confidence=prob_in)
    else:
        return Prediction(label="out", confidence=prob_out)


def predict_with_heuristics(
    box: BoxBounds,
    layout: VideoLayoutConfig,
) -> Prediction:
    """Predict label using spatial heuristics (fallback).

    Universal heuristics based on:
    - Vertical position (captions typically in bottom portion of frame)
    - Box height (relative to frame)

    Args:
        box: Box bounds in top-referenced coordinates
        layout: Video layout configuration

    Returns:
        Prediction with label and confidence
    """
    frame_height = layout.frame_height
    box_center_y = (box.top + box.bottom) / 2
    box_height = box.bottom - box.top

    # Expected caption characteristics
    EXPECTED_CAPTION_Y = 0.75  # 75% from top (bottom quarter)
    EXPECTED_CAPTION_HEIGHT_RATIO = 0.05  # 5% of frame height

    # Score 1: Vertical position penalty
    normalized_y = box_center_y / frame_height if frame_height > 0 else 0.5
    y_deviation = abs(normalized_y - EXPECTED_CAPTION_Y)
    y_score = max(0, 1.0 - y_deviation * 2.5)  # Full penalty at 40% deviation

    # Score 2: Box height penalty
    height_ratio = box_height / frame_height if frame_height > 0 else 0
    height_deviation = abs(height_ratio - EXPECTED_CAPTION_HEIGHT_RATIO)
    height_score = max(0, 1.0 - height_deviation / EXPECTED_CAPTION_HEIGHT_RATIO)

    # Combine scores
    caption_score = y_score * 0.6 + height_score * 0.4

    # Convert to label and confidence
    if caption_score >= 0.6:
        return Prediction(label="in", confidence=0.5 + caption_score * 0.3)
    else:
        return Prediction(label="out", confidence=0.5 + (1 - caption_score) * 0.3)


def predict_box_label(
    box: BoxBounds,
    layout: VideoLayoutConfig,
    all_boxes: list[BoxBounds],
    conn: sqlite3.Connection | None = None,
) -> Prediction:
    """Predict label and confidence for an OCR box.

    Uses trained Bayesian model if available, otherwise falls back to heuristics.

    Args:
        box: Box bounds in top-referenced coordinates
        layout: Video layout configuration
        all_boxes: All boxes for k-nn comparison
        conn: SQLite database connection (optional)

    Returns:
        Prediction with label and confidence
    """
    # Try to use Bayesian model if database provided
    if conn:
        try:
            model = load_model(conn)
            if model:
                # Get box text and timestamp
                box_text, timestamp_seconds = get_box_text_and_timestamp(conn, box.frame_index, box.box_index)
                duration_seconds = get_video_duration(conn)

                # Extract features
                features = extract_features(
                    box=box,
                    frame_width=layout.frame_width,
                    frame_height=layout.frame_height,
                    all_boxes=all_boxes,
                    timestamp_seconds=timestamp_seconds,
                    duration_seconds=duration_seconds,
                    conn=conn,
                )

                return predict_bayesian(features, model)
        except Exception as e:
            logger.error(f"Error using Bayesian model: {e}")

    # Fall back to heuristics
    return predict_with_heuristics(box, layout)


def predict_from_features(
    features: list[float],
    model: ModelParams | None,
    box: BoxBounds | None = None,
    layout: VideoLayoutConfig | None = None,
) -> Prediction:
    """Predict label from pre-extracted features.

    Useful for batch prediction when features are already extracted.

    Args:
        features: 26-dimensional feature vector
        model: Model parameters (or None to use heuristics)
        box: Box bounds for heuristics fallback (optional)
        layout: Layout config for heuristics fallback (optional)

    Returns:
        Prediction with label and confidence
    """
    if model:
        return predict_bayesian(features, model)

    # Fall back to heuristics if box and layout provided
    if box and layout:
        return predict_with_heuristics(box, layout)

    # Default uncertain prediction
    return Prediction(label="in", confidence=0.5)


def predict_batch(
    boxes: list[BoxBounds],
    layout: VideoLayoutConfig,
    all_boxes: list[BoxBounds],
    conn: sqlite3.Connection | None = None,
) -> list[Prediction]:
    """Predict labels for multiple boxes.

    Args:
        boxes: List of boxes to predict
        layout: Video layout configuration
        all_boxes: All boxes for k-nn comparison
        conn: SQLite database connection (optional)

    Returns:
        List of predictions, one per box
    """
    return [predict_box_label(box, layout, all_boxes, conn) for box in boxes]


def get_confident_predictions(
    predictions: list[Prediction],
    threshold: float = 0.7,
) -> list[int]:
    """Get indices of predictions with confidence above threshold.

    Args:
        predictions: List of predictions
        threshold: Confidence threshold [0-1]

    Returns:
        List of indices where confidence >= threshold
    """
    return [i for i, pred in enumerate(predictions) if pred.confidence >= threshold]


def get_uncertain_predictions(
    predictions: list[Prediction],
    threshold: float = 0.6,
) -> list[int]:
    """Get indices of predictions with confidence below threshold.

    Useful for prioritizing boxes for manual annotation.

    Args:
        predictions: List of predictions
        threshold: Confidence threshold [0-1]

    Returns:
        List of indices where confidence < threshold
    """
    return [i for i, pred in enumerate(predictions) if pred.confidence < threshold]
