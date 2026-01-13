"""Coordinate system conversions for OCR bounding boxes.

This module provides functions to convert between original (non-cropped) and
cropped coordinate systems. OCR box annotations are always stored in original
frame coordinates (absolute pixels) to remain independent of cropping bound changes.

Coordinate System Notes:
- Original: Absolute pixel coordinates relative to full video frame
- Cropped: Absolute pixel coordinates relative to cropped region
- Both use top-left origin (0,0 = top-left corner)
- Storage uses pixels (not fractional) for precision and direct OCR compatibility
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class BoundingBox:
    """Bounding box in absolute pixel coordinates.

    Coordinates are relative to the frame (either original or cropped).
    Origin is top-left (0,0).

    Attributes:
        left: Left edge in pixels (x coordinate)
        top: Top edge in pixels (y coordinate)
        right: Right edge in pixels (x coordinate)
        bottom: Bottom edge in pixels (y coordinate)
    """

    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        """Box width in pixels."""
        return self.right - self.left

    @property
    def height(self) -> int:
        """Box height in pixels."""
        return self.bottom - self.top

    @property
    def center_x(self) -> float:
        """Horizontal center position in pixels."""
        return (self.left + self.right) / 2.0

    @property
    def center_y(self) -> float:
        """Vertical center position in pixels."""
        return (self.top + self.bottom) / 2.0

    @property
    def area(self) -> int:
        """Box area in square pixels."""
        return self.width * self.height

    def to_fractional(self, frame_width: int, frame_height: int) -> tuple[float, float, float, float]:
        """Convert pixel coords to fractional [0-1] coords.

        Useful for frontend display or APIs that expect fractional coordinates.

        Args:
            frame_width: Frame width in pixels
            frame_height: Frame height in pixels

        Returns:
            Tuple of (left_frac, top_frac, right_frac, bottom_frac) in range [0-1]
        """
        return (
            self.left / frame_width,
            self.top / frame_height,
            self.right / frame_width,
            self.bottom / frame_height,
        )

    @classmethod
    def from_fractional(
        cls, left: float, top: float, right: float, bottom: float, frame_width: int, frame_height: int
    ) -> "BoundingBox":
        """Create BoundingBox from fractional [0-1] coordinates.

        Args:
            left: Left edge fractional [0-1]
            top: Top edge fractional [0-1]
            right: Right edge fractional [0-1]
            bottom: Bottom edge fractional [0-1]
            frame_width: Frame width in pixels
            frame_height: Frame height in pixels

        Returns:
            BoundingBox with pixel coordinates
        """
        return cls(
            left=int(left * frame_width),
            top=int(top * frame_height),
            right=int(right * frame_width),
            bottom=int(bottom * frame_height),
        )

    def is_inside(self, other: "BoundingBox") -> bool:
        """Check if this box is completely inside another box.

        Args:
            other: The bounding box to check against

        Returns:
            True if this box is completely inside other box
        """
        return (
            self.left >= other.left
            and self.top >= other.top
            and self.right <= other.right
            and self.bottom <= other.bottom
        )

    def overlaps(self, other: "BoundingBox") -> bool:
        """Check if this box overlaps with another box.

        Args:
            other: The bounding box to check against

        Returns:
            True if boxes overlap
        """
        return not (
            self.right <= other.left or self.left >= other.right or self.bottom <= other.top or self.top >= other.bottom
        )

    def intersection(self, other: "BoundingBox") -> Optional["BoundingBox"]:
        """Calculate intersection of this box with another.

        Args:
            other: The bounding box to intersect with

        Returns:
            BoundingBox of intersection, or None if no overlap
        """
        if not self.overlaps(other):
            return None

        return BoundingBox(
            left=max(self.left, other.left),
            top=max(self.top, other.top),
            right=min(self.right, other.right),
            bottom=min(self.bottom, other.bottom),
        )

    def overlap_fraction(self, other: "BoundingBox") -> float:
        """Calculate fraction of this box that overlaps with another.

        Args:
            other: The bounding box to check overlap with

        Returns:
            Fraction [0-1] of this box's area that overlaps with other
        """
        intersection = self.intersection(other)
        if intersection is None:
            return 0.0

        intersection_area = intersection.area
        this_area = self.area

        if this_area == 0:
            return 0.0

        return intersection_area / this_area


@dataclass
class CropRegion:
    """Crop region bounds in absolute pixel coordinates.

    Defines a rectangular region within the original frame.
    All coordinates are in pixels relative to the original frame.

    Attributes:
        left: Left edge of crop region in pixels
        top: Top edge of crop region in pixels
        right: Right edge of crop region in pixels
        bottom: Bottom edge of crop region in pixels
    """

    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        """Crop region width in pixels."""
        return self.right - self.left

    @property
    def height(self) -> int:
        """Crop region height in pixels."""
        return self.bottom - self.top

    def to_bounding_box(self) -> BoundingBox:
        """Convert crop region to bounding box."""
        return BoundingBox(
            left=self.left,
            top=self.top,
            right=self.right,
            bottom=self.bottom,
        )

    def to_fractional(self, frame_width: int, frame_height: int) -> tuple[float, float, float, float]:
        """Convert to fractional coordinates.

        Args:
            frame_width: Original frame width in pixels
            frame_height: Original frame height in pixels

        Returns:
            Tuple of (left_frac, top_frac, right_frac, bottom_frac)
        """
        return (
            self.left / frame_width,
            self.top / frame_height,
            self.right / frame_width,
            self.bottom / frame_height,
        )

    @classmethod
    def from_fractional(
        cls, left: float, top: float, right: float, bottom: float, frame_width: int, frame_height: int
    ) -> "CropRegion":
        """Create from fractional coordinates.

        Args:
            left: Left fractional [0-1]
            top: Top fractional [0-1]
            right: Right fractional [0-1]
            bottom: Bottom fractional [0-1]
            frame_width: Original frame width in pixels
            frame_height: Original frame height in pixels

        Returns:
            CropRegion with pixel coordinates
        """
        return cls(
            left=int(left * frame_width),
            top=int(top * frame_height),
            right=int(right * frame_width),
            bottom=int(bottom * frame_height),
        )


def original_to_cropped(box: BoundingBox, crop_region: CropRegion) -> Optional[BoundingBox]:
    """Convert original frame coords to cropped frame coords.

    Takes a bounding box in original frame coordinates (pixels) and converts it to
    coordinates relative to the cropped region (also pixels). If the box is completely
    outside the crop region, returns None.

    Args:
        box: Bounding box in original frame pixel coordinates
        crop_region: Crop region boundaries in original frame pixel coordinates

    Returns:
        BoundingBox in cropped frame pixel coordinates, or None if box is outside crop region

    Example:
        >>> # Original: Box at (960, 864) to (1152, 972) in 1920x1080 frame
        >>> box = BoundingBox(left=960, top=864, right=1152, bottom=972)
        >>> # Crop: Bottom half of frame (top=540)
        >>> crop = CropRegion(left=0, top=540, right=1920, bottom=1080)
        >>> cropped = original_to_cropped(box, crop)
        >>> # In cropped coords: top becomes 864-540 = 324
        >>> print(f"{cropped.left}, {cropped.top}, {cropped.right}, {cropped.bottom}")
        960, 324, 1152, 432
    """
    # Check if box is completely outside crop region
    crop_box = crop_region.to_bounding_box()
    if not box.overlaps(crop_box):
        return None

    # Clamp box to crop region
    clamped_left = max(box.left, crop_region.left)
    clamped_top = max(box.top, crop_region.top)
    clamped_right = min(box.right, crop_region.right)
    clamped_bottom = min(box.bottom, crop_region.bottom)

    # Convert to cropped coordinates by subtracting crop offset
    cropped_left = clamped_left - crop_region.left
    cropped_top = clamped_top - crop_region.top
    cropped_right = clamped_right - crop_region.left
    cropped_bottom = clamped_bottom - crop_region.top

    return BoundingBox(
        left=cropped_left,
        top=cropped_top,
        right=cropped_right,
        bottom=cropped_bottom,
    )


def cropped_to_original(box: BoundingBox, crop_region: CropRegion) -> BoundingBox:
    """Convert cropped frame coords to original frame coords.

    Takes a bounding box in cropped frame coordinates (pixels) and converts it back to
    coordinates relative to the original full frame (pixels).

    Args:
        box: Bounding box in cropped frame pixel coordinates
        crop_region: Crop region boundaries in original frame pixel coordinates

    Returns:
        BoundingBox in original frame pixel coordinates

    Example:
        >>> # Cropped: Box at (960, 324) to (1152, 432)
        >>> box = BoundingBox(left=960, top=324, right=1152, bottom=432)
        >>> # Crop: Bottom half (top=540)
        >>> crop = CropRegion(left=0, top=540, right=1920, bottom=1080)
        >>> original = cropped_to_original(box, crop)
        >>> # In original coords: top becomes 324+540 = 864
        >>> print(f"{original.left}, {original.top}, {original.right}, {original.bottom}")
        960, 864, 1152, 972
    """
    # Add crop offset to convert to original coordinates
    original_left = box.left + crop_region.left
    original_top = box.top + crop_region.top
    original_right = box.right + crop_region.left
    original_bottom = box.bottom + crop_region.top

    return BoundingBox(
        left=original_left,
        top=original_top,
        right=original_right,
        bottom=original_bottom,
    )


def is_box_inside_crop(box: BoundingBox, crop_region: CropRegion) -> bool:
    """Check if a box (in original coords) is completely inside crop region.

    Args:
        box: Bounding box in original frame pixel coordinates
        crop_region: Crop region boundaries

    Returns:
        True if box is completely inside crop region
    """
    return box.is_inside(crop_region.to_bounding_box())


def box_overlap_with_crop(box: BoundingBox, crop_region: CropRegion) -> float:
    """Calculate fraction of box (in original coords) that overlaps with crop region.

    Args:
        box: Bounding box in original frame pixel coordinates
        crop_region: Crop region boundaries

    Returns:
        Fraction [0-1] of box area that overlaps with crop region
    """
    return box.overlap_fraction(crop_region.to_bounding_box())
