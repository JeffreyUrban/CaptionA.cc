"""
Shared data models for Prefect flows.

These models define the contracts between flows and Modal functions.
"""

from dataclasses import dataclass


@dataclass
class CropRegion:
    """
    Normalized crop region coordinates (0.0 to 1.0).
    Defines the rectangular region to extract from video frames.
    """

    crop_left: float  # 0.0 = left edge, 1.0 = right edge
    crop_top: float  # 0.0 = top edge, 1.0 = bottom edge
    crop_right: float  # 0.0 = left edge, 1.0 = right edge
    crop_bottom: float  # 0.0 = top edge, 1.0 = bottom edge

    def __post_init__(self):
        """Validate crop region coordinates."""
        assert 0.0 <= self.crop_left < self.crop_right <= 1.0, (
            f"Invalid horizontal crop: {self.crop_left} to {self.crop_right}"
        )
        assert 0.0 <= self.crop_top < self.crop_bottom <= 1.0, (
            f"Invalid vertical crop: {self.crop_top} to {self.crop_bottom}"
        )
