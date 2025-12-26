"""Feature extraction for box classification."""

from typing import TypedDict


class BoxBounds(TypedDict):
    """Box boundaries in pixels."""
    left: int
    top: int
    right: int
    bottom: int


class VideoLayoutConfig(TypedDict, total=False):
    """Video layout configuration parameters."""
    frame_width: int
    frame_height: int
    crop_left: int
    crop_top: int
    crop_right: int
    crop_bottom: int
    vertical_position: int | None
    vertical_std: float | None
    box_height: int | None
    box_height_std: float | None
    anchor_type: str | None  # 'left' | 'center' | 'right'
    anchor_position: int | None


def extract_features(box: BoxBounds, layout: VideoLayoutConfig) -> list[float]:
    """
    Extract 7 features from a box given layout parameters.

    Features:
    1. vertical_alignment_zscore: (box_center_y - expected_y) / std
    2. height_similarity_zscore: (box_height - expected_height) / std
    3. anchor_distance: Distance from anchor line (left/center/right)
    4. crop_overlap: Percentage overlapping with crop bounds [0-1]
    5. aspect_ratio: box_width / box_height
    6. normalized_y_position: box_center_y / frame_height [0-1]
    7. normalized_area: box_area / frame_area [0-1]

    Args:
        box: Box boundaries in pixels
        layout: Video layout configuration

    Returns:
        List of 7 feature values
    """
    box_left = box['left']
    box_top = box['top']
    box_right = box['right']
    box_bottom = box['bottom']

    frame_width = layout['frame_width']
    frame_height = layout['frame_height']

    # Calculate box properties
    box_width = box_right - box_left
    box_height = box_bottom - box_top
    box_center_x = (box_left + box_right) / 2
    box_center_y = (box_top + box_bottom) / 2
    box_area = box_width * box_height
    frame_area = frame_width * frame_height

    # Feature 1: Vertical alignment Z-score
    if layout.get('vertical_position') is not None and layout.get('vertical_std') is not None:
        vertical_distance = abs(box_center_y - layout['vertical_position'])
        vertical_std = layout['vertical_std'] if layout['vertical_std'] > 0 else 1.0
        vertical_alignment_zscore = vertical_distance / vertical_std
    else:
        vertical_alignment_zscore = 0.0

    # Feature 2: Height similarity Z-score
    if layout.get('box_height') is not None and layout.get('box_height_std') is not None:
        height_difference = abs(box_height - layout['box_height'])
        height_std = layout['box_height_std'] if layout['box_height_std'] > 0 else 1.0
        height_similarity_zscore = height_difference / height_std
    else:
        height_similarity_zscore = 0.0

    # Feature 3: Anchor distance
    if layout.get('anchor_type') and layout.get('anchor_position') is not None:
        anchor_type = layout['anchor_type']
        anchor_position = layout['anchor_position']

        if anchor_type == 'left':
            anchor_distance = abs(box_left - anchor_position)
        elif anchor_type == 'right':
            anchor_distance = abs(box_right - anchor_position)
        else:  # 'center'
            anchor_distance = abs(box_center_x - anchor_position)
    else:
        anchor_distance = 0.0

    # Feature 4: Crop overlap
    crop_left = layout.get('crop_left', 0)
    crop_top = layout.get('crop_top', 0)
    crop_right = layout.get('crop_right', frame_width)
    crop_bottom = layout.get('crop_bottom', frame_height)

    # Calculate intersection
    overlap_left = max(box_left, crop_left)
    overlap_top = max(box_top, crop_top)
    overlap_right = min(box_right, crop_right)
    overlap_bottom = min(box_bottom, crop_bottom)

    if overlap_right > overlap_left and overlap_bottom > overlap_top:
        overlap_area = (overlap_right - overlap_left) * (overlap_bottom - overlap_top)
        crop_overlap = overlap_area / box_area if box_area > 0 else 0.0
    else:
        crop_overlap = 0.0

    # Feature 5: Aspect ratio
    aspect_ratio = box_width / box_height if box_height > 0 else 0.0

    # Feature 6: Normalized Y position
    normalized_y_position = box_center_y / frame_height if frame_height > 0 else 0.0

    # Feature 7: Normalized area
    normalized_area = box_area / frame_area if frame_area > 0 else 0.0

    return [
        vertical_alignment_zscore,
        height_similarity_zscore,
        anchor_distance,
        crop_overlap,
        aspect_ratio,
        normalized_y_position,
        normalized_area,
    ]
