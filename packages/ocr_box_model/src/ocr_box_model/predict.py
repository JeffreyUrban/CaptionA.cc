"""OCR box prediction using spatial heuristics and Bayesian priors.

Provides bootstrap classification before user annotations exist.
Uses layout parameters from SubtitleRegion analysis as Bayesian priors.
"""

import math
from typing import TypedDict

from caption_models import BoundingBox, CropRegion

from ocr_box_model.features import LayoutParams, extract_box_features


class Prediction(TypedDict):
    """Prediction result for a single box."""

    label: str  # "in" or "out"
    confidence: float  # [0-1]


def gaussian_prob(x: float, mean: float, std: float) -> float:
    """Calculate Gaussian probability density.

    Args:
        x: Value to evaluate
        mean: Mean of distribution
        std: Standard deviation

    Returns:
        Probability density (unnormalized)
    """
    if std <= 0:
        return 1.0 if abs(x - mean) < 1e-6 else 0.0

    z = (x - mean) / std
    return math.exp(-0.5 * z * z)


def predict_box_with_heuristics(
    box: BoundingBox,
    frame_width: int,
    frame_height: int,
    crop_region: CropRegion,
    layout_params: LayoutParams,
    selection_rect: BoundingBox | None = None,
) -> Prediction:
    """Predict box label using spatial heuristics and Bayesian priors.

    Decision logic (using layout parameters as Bayesian priors):

    1. Hard constraint: Box outside crop region → "out" (high confidence)
    2. Hard constraint: Box outside selection rect → "out" (high confidence)
    3. Bayesian scoring using layout priors:
       - Vertical position likelihood
       - Height similarity likelihood
       - Anchor consistency
       - Combined likelihood → confidence

    Args:
        box: Bounding box in original frame pixel coordinates
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        crop_region: Crop region boundaries
        layout_params: Layout parameters as Bayesian priors
        selection_rect: Optional selection rectangle constraint

    Returns:
        Prediction with label and confidence
    """
    # Extract features
    features = extract_box_features(
        box=box,
        frame_width=frame_width,
        frame_height=frame_height,
        crop_region=crop_region,
        layout_params=layout_params,
        selection_rect=selection_rect,
    )

    # Hard constraint 1: Outside crop region
    if not features["inside_crop_region"]:
        # Box completely outside caption region
        overlap = features["overlap_with_crop"]
        if overlap == 0.0:
            return Prediction(label="out", confidence=0.95)
        else:
            # Partial overlap - lower confidence "out"
            confidence = 0.7 + (1.0 - overlap) * 0.2
            return Prediction(label="out", confidence=confidence)

    # Hard constraint 2: Outside selection rectangle (if exists)
    if selection_rect is not None and not features["inside_selection_rect"]:
        overlap = features["overlap_with_selection"]
        if overlap == 0.0:
            return Prediction(label="out", confidence=0.92)
        else:
            # Partial overlap with selection
            confidence = 0.65 + (1.0 - overlap) * 0.25
            return Prediction(label="out", confidence=confidence)

    # Bayesian scoring using layout priors
    # Calculate likelihoods based on Gaussian distributions

    # Vertical position likelihood
    vertical_prob = gaussian_prob(
        x=float(features["box_center_y"]),
        mean=float(layout_params["vertical_position"]),
        std=layout_params["vertical_std"],
    )

    # Height likelihood
    height_prob = gaussian_prob(
        x=float(features["box_height"]),
        mean=float(layout_params["box_height"]),
        std=layout_params["box_height_std"],
    )

    # Anchor consistency [0-1]
    anchor_prob = features["anchor_consistency"]

    # Combine likelihoods (weighted geometric mean)
    # Vertical position is most important, then height, then anchor
    combined_likelihood = vertical_prob**0.5 * height_prob**0.3 * anchor_prob**0.2

    # Normalize to [0-1] confidence range
    # High likelihood → high confidence "in"
    # Low likelihood → high confidence "out"

    # Use threshold-based classification with confidence
    # threshold tuned to balance precision/recall
    if combined_likelihood > 0.5:
        # Likely caption text
        # Confidence increases with likelihood
        confidence = 0.5 + min(combined_likelihood, 1.0) * 0.4
        return Prediction(label="in", confidence=confidence)
    elif combined_likelihood > 0.2:
        # Uncertain region
        # Lower confidence
        if combined_likelihood > 0.35:
            # Lean toward "in" but uncertain
            confidence = 0.4 + (combined_likelihood - 0.35) * 0.5
            return Prediction(label="in", confidence=confidence)
        else:
            # Lean toward "out" but uncertain
            confidence = 0.4 + (0.35 - combined_likelihood) * 0.5
            return Prediction(label="out", confidence=confidence)
    else:
        # Likely not caption text
        # Confidence increases as likelihood decreases
        confidence = 0.5 + (0.5 - min(combined_likelihood, 0.5)) * 0.8
        return Prediction(label="out", confidence=confidence)


def predict_with_heuristics(
    boxes: list[BoundingBox],
    frame_width: int,
    frame_height: int,
    crop_region: CropRegion,
    layout_params: LayoutParams,
    selection_rect: BoundingBox | None = None,
) -> list[Prediction]:
    """Predict labels for multiple boxes using spatial heuristics.

    Args:
        boxes: List of bounding boxes in original frame coordinates
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        crop_region: Crop region boundaries
        layout_params: Layout parameters as Bayesian priors
        selection_rect: Optional selection rectangle constraint

    Returns:
        List of predictions, one per box

    Example:
        >>> boxes = [
        ...     BoundingBox(left=960, top=918, right=998, bottom=972),  # Caption
        ...     BoundingBox(left=1632, top=54, right=1824, bottom=130),  # Logo
        ... ]
        >>> layout_params = {
        ...     'vertical_position': 945,
        ...     'vertical_std': 12.0,
        ...     'box_height': 54,
        ...     'box_height_std': 5.0,
        ...     'anchor_type': 'left',
        ...     'anchor_position': 960,
        ... }
        >>> crop = CropRegion(left=0, top=723, right=1920, bottom=1080)
        >>> predictions = predict_with_heuristics(
        ...     boxes=boxes,
        ...     frame_width=1920,
        ...     frame_height=1080,
        ...     crop_region=crop,
        ...     layout_params=layout_params,
        ... )
        >>> # predictions[0] = {'label': 'in', 'confidence': 0.87}
        >>> # predictions[1] = {'label': 'out', 'confidence': 0.95}
    """
    return [
        predict_box_with_heuristics(
            box=box,
            frame_width=frame_width,
            frame_height=frame_height,
            crop_region=crop_region,
            layout_params=layout_params,
            selection_rect=selection_rect,
        )
        for box in boxes
    ]


def get_confident_predictions(predictions: list[Prediction], threshold: float = 0.7) -> list[int]:
    """Get indices of predictions with confidence above threshold.

    Useful for identifying boxes that need manual annotation.

    Args:
        predictions: List of predictions
        threshold: Confidence threshold [0-1]

    Returns:
        List of indices where confidence >= threshold
    """
    return [i for i, pred in enumerate(predictions) if pred["confidence"] >= threshold]


def get_uncertain_predictions(predictions: list[Prediction], threshold: float = 0.6) -> list[int]:
    """Get indices of predictions with confidence below threshold.

    Useful for prioritizing boxes for manual annotation.

    Args:
        predictions: List of predictions
        threshold: Confidence threshold [0-1]

    Returns:
        List of indices where confidence < threshold
    """
    return [i for i, pred in enumerate(predictions) if pred["confidence"] < threshold]
