"""Data models for subtitle/caption region analysis."""

from dataclasses import dataclass


@dataclass
class SubtitleRegion:
    """Analyzed subtitle region characteristics.

    This model captures the spatial and layout properties of burned-in subtitles
    detected in video frames through OCR analysis.

    Attributes:
        vertical_position: Mode of vertical center position in pixels
        vertical_std: Standard deviation of vertical position
        box_height: Mode of box heights in pixels
        height_std: Standard deviation of box heights
        anchor_type: Text alignment - "left", "center", or "right"
        anchor_position: Mode of anchor position in pixels (depends on anchor_type)
        crop_left: Left boundary of recommended crop region in pixels
        crop_top: Top boundary of recommended crop region in pixels
        crop_right: Right boundary of recommended crop region in pixels
        crop_bottom: Bottom boundary of recommended crop region in pixels
        total_boxes: Number of OCR boxes analyzed
    """

    vertical_position: float
    vertical_std: float
    box_height: float
    height_std: float
    anchor_type: str
    anchor_position: float
    crop_left: int
    crop_top: int
    crop_right: int
    crop_bottom: int
    total_boxes: int
