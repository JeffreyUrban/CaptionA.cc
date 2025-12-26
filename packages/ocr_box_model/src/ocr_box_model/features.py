"""Feature extraction for OCR box classification.

Extracts spatial, layout alignment, and context features from OCR bounding boxes
for use in caption text classification. All coordinates are in absolute pixels.
"""

from typing import TypedDict

from caption_models import BoundingBox, CropBounds, box_overlap_with_crop, is_box_inside_crop


class LayoutParams(TypedDict):
    """Layout parameters from SubtitleRegion analysis (Bayesian priors).

    All measurements in absolute pixels relative to original frame.
    """

    vertical_position: int  # Mode of vertical center position
    vertical_std: float  # Standard deviation (Bayesian prior)
    box_height: int  # Mode of box heights
    box_height_std: float  # Standard deviation (Bayesian prior)
    anchor_type: str  # "left", "center", or "right"
    anchor_position: int  # Mode of anchor position in pixels


class BoxFeatures(TypedDict):
    """Extracted features for a single OCR box.

    All spatial measurements in absolute pixels.
    Normalized features are in range [0-1] or standardized (z-scores).
    """

    # Spatial features (absolute pixels)
    box_center_x: int
    box_center_y: int
    box_width: int
    box_height: int
    box_area: int

    # Spatial features (normalized [0-1])
    box_center_x_norm: float  # Relative to frame width
    box_center_y_norm: float  # Relative to frame height

    # Layout alignment features (pixels)
    vertical_distance_from_mode: int  # Distance from predicted vertical center
    horizontal_distance_from_anchor: int  # Distance from anchor position
    height_difference_from_mode: int  # Difference from predicted height

    # Layout alignment features (standardized z-scores)
    vertical_alignment_score: float  # (distance / vertical_std)
    height_similarity_score: float  # (difference / box_height_std)

    # Anchor alignment
    anchor_consistency: float  # [0-1] how well box aligns with anchor type

    # Constraint features
    inside_crop_bounds: bool
    overlap_with_crop: float  # [0-1]
    inside_selection_rect: bool  # If selection rect exists
    overlap_with_selection: float  # [0-1]

    # Context features
    aspect_ratio: float  # width / height


def extract_box_features(
    box: BoundingBox,
    frame_width: int,
    frame_height: int,
    crop_bounds: CropBounds,
    layout_params: LayoutParams,
    selection_rect: BoundingBox | None = None,
) -> BoxFeatures:
    """Extract features from a single OCR box.

    Args:
        box: Bounding box in original frame pixel coordinates
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        crop_bounds: Crop region in original frame coordinates
        layout_params: Layout parameters from SubtitleRegion analysis
        selection_rect: Optional selection rectangle constraint (original coords)

    Returns:
        Extracted features for classification
    """
    # Spatial features (absolute)
    center_x = int(box.center_x)
    center_y = int(box.center_y)
    width = box.width
    height = box.height
    area = box.area

    # Spatial features (normalized)
    center_x_norm = center_x / frame_width
    center_y_norm = center_y / frame_height

    # Layout alignment (absolute distances)
    vertical_distance = abs(center_y - layout_params["vertical_position"])
    height_difference = abs(height - layout_params["box_height"])

    # Horizontal anchor distance depends on anchor type
    if layout_params["anchor_type"] == "left":
        horizontal_distance = abs(box.left - layout_params["anchor_position"])
    elif layout_params["anchor_type"] == "right":
        horizontal_distance = abs(box.right - layout_params["anchor_position"])
    else:  # center
        horizontal_distance = abs(center_x - layout_params["anchor_position"])

    # Layout alignment (standardized z-scores)
    vertical_std = max(layout_params["vertical_std"], 1.0)  # Avoid division by zero
    height_std = max(layout_params["box_height_std"], 1.0)

    vertical_alignment_score = vertical_distance / vertical_std
    height_similarity_score = height_difference / height_std

    # Anchor consistency [0-1]
    # Measures how consistently the box aligns with the anchor type
    # High score = box aligns well with anchor type
    if layout_params["anchor_type"] == "left":
        # Left-aligned text has consistent left edges
        anchor_consistency = 1.0 - min(horizontal_distance / frame_width, 1.0)
    elif layout_params["anchor_type"] == "right":
        # Right-aligned text has consistent right edges
        anchor_consistency = 1.0 - min(horizontal_distance / frame_width, 1.0)
    else:  # center
        # Center-aligned text has centers near anchor
        anchor_consistency = 1.0 - min(horizontal_distance / (frame_width / 2), 1.0)

    # Constraint features
    inside_crop = is_box_inside_crop(box, crop_bounds)
    overlap_crop = box_overlap_with_crop(box, crop_bounds)

    if selection_rect is not None:
        inside_selection = box.is_inside(selection_rect)
        overlap_selection = box.overlap_fraction(selection_rect)
    else:
        inside_selection = True  # No constraint if no selection rect
        overlap_selection = 1.0

    # Aspect ratio
    aspect_ratio = width / height if height > 0 else 0.0

    return BoxFeatures(
        # Spatial (absolute)
        box_center_x=center_x,
        box_center_y=center_y,
        box_width=width,
        box_height=height,
        box_area=area,
        # Spatial (normalized)
        box_center_x_norm=center_x_norm,
        box_center_y_norm=center_y_norm,
        # Layout alignment (absolute)
        vertical_distance_from_mode=vertical_distance,
        horizontal_distance_from_anchor=horizontal_distance,
        height_difference_from_mode=height_difference,
        # Layout alignment (standardized)
        vertical_alignment_score=vertical_alignment_score,
        height_similarity_score=height_similarity_score,
        anchor_consistency=anchor_consistency,
        # Constraints
        inside_crop_bounds=inside_crop,
        overlap_with_crop=overlap_crop,
        inside_selection_rect=inside_selection,
        overlap_with_selection=overlap_selection,
        # Shape
        aspect_ratio=aspect_ratio,
    )


def extract_features_batch(
    boxes: list[BoundingBox],
    frame_width: int,
    frame_height: int,
    crop_bounds: CropBounds,
    layout_params: LayoutParams,
    selection_rect: BoundingBox | None = None,
) -> list[BoxFeatures]:
    """Extract features from multiple OCR boxes.

    Args:
        boxes: List of bounding boxes in original frame coordinates
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        crop_bounds: Crop region in original frame coordinates
        layout_params: Layout parameters from SubtitleRegion analysis
        selection_rect: Optional selection rectangle constraint

    Returns:
        List of extracted features, one per box
    """
    return [
        extract_box_features(
            box=box,
            frame_width=frame_width,
            frame_height=frame_height,
            crop_bounds=crop_bounds,
            layout_params=layout_params,
            selection_rect=selection_rect,
        )
        for box in boxes
    ]


def features_to_array(features: BoxFeatures) -> list[float]:
    """Convert BoxFeatures to numerical array for ML models.

    Args:
        features: Extracted box features

    Returns:
        List of numerical feature values for model input

    Feature order:
        0: box_center_x_norm
        1: box_center_y_norm
        2: box_width
        3: box_height
        4: vertical_alignment_score
        5: height_similarity_score
        6: horizontal_distance_from_anchor
        7: anchor_consistency
        8: inside_crop_bounds (0 or 1)
        9: overlap_with_crop
        10: inside_selection_rect (0 or 1)
        11: overlap_with_selection
        12: aspect_ratio
    """
    return [
        features["box_center_x_norm"],
        features["box_center_y_norm"],
        float(features["box_width"]),
        float(features["box_height"]),
        features["vertical_alignment_score"],
        features["height_similarity_score"],
        float(features["horizontal_distance_from_anchor"]),
        features["anchor_consistency"],
        float(features["inside_crop_bounds"]),
        features["overlap_with_crop"],
        float(features["inside_selection_rect"]),
        features["overlap_with_selection"],
        features["aspect_ratio"],
    ]


def features_batch_to_array(features_list: list[BoxFeatures]) -> list[list[float]]:
    """Convert batch of BoxFeatures to numerical arrays.

    Args:
        features_list: List of extracted box features

    Returns:
        List of numerical feature arrays for model input
    """
    return [features_to_array(f) for f in features_list]
