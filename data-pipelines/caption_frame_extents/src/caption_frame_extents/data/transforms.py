"""Transform utilities for caption frame extents detection.

Implements anchor-aware resizing that preserves text positioning based on
the caption's anchor type (left/center/right).
"""

from enum import Enum
from typing import Literal

import numpy as np
from PIL import Image


class ResizeStrategy(str, Enum):
    """Strategy for handling variable-sized crops."""

    CROP = "crop"  # Crop oversized images
    MIRROR_TILE = "mirror_tile"  # Mirror-tile undersized images
    ADAPTIVE = "adaptive"  # Crop if >20% wider, else mirror-tile


class AnchorAwareResize:
    """Resize images to fixed dimensions while respecting anchor positioning.

    This transform handles variable-sized caption crops by:
    1. Resizing to target height (preserving aspect ratio)
    2. For oversized widths: Crop based on anchor position
    3. For undersized widths: Mirror-tile away from anchor

    The key insight: anchors indicate where text is "pinned" in the frame.
    - Left anchor: Text starts at left edge, extends right
    - Right anchor: Text ends at right edge, extends left
    - Center anchor: Text centered, extends both directions

    When cropping/tiling, we preserve the anchor region and modify away from it.

    Args:
        target_width: Target width in pixels (default: 480)
        target_height: Target height in pixels (default: 48)
        strategy: Resize strategy (crop, mirror_tile, or adaptive)
        crop_threshold: For adaptive mode, crop if width > target * (1 + threshold)

    Example:
        >>> transform = AnchorAwareResize(
        ...     target_width=480,
        ...     target_height=48,
        ...     strategy=ResizeStrategy.MIRROR_TILE
        ... )
        >>> resized = transform(image, anchor_type="left")
    """

    def __init__(
        self,
        target_width: int = 480,
        target_height: int = 48,
        strategy: ResizeStrategy = ResizeStrategy.MIRROR_TILE,
        crop_threshold: float = 0.2,
    ):
        self.target_width = target_width
        self.target_height = target_height
        self.strategy = strategy
        self.crop_threshold = crop_threshold

    def __call__(
        self,
        image: Image.Image,
        anchor_type: Literal["left", "center", "right"],
    ) -> Image.Image:
        """Apply anchor-aware resize to image.

        Args:
            image: PIL Image to resize
            anchor_type: Caption anchor position

        Returns:
            Resized PIL Image of size (target_width, target_height)
        """
        # Step 1: Resize to target height, preserving aspect ratio
        aspect_ratio = image.width / image.height
        new_width = int(self.target_height * aspect_ratio)
        resized = image.resize(
            (new_width, self.target_height), Image.Resampling.LANCZOS
        )

        # Step 2: Handle width (crop or tile based on strategy)
        if new_width == self.target_width:
            return resized  # Perfect fit!

        # Determine strategy for this image
        if self.strategy == ResizeStrategy.CROP:
            return (
                self._crop(resized, anchor_type)
                if new_width > self.target_width
                else self._mirror_tile(resized, anchor_type)
            )
        elif self.strategy == ResizeStrategy.MIRROR_TILE:
            return (
                self._mirror_tile(resized, anchor_type)
                if new_width < self.target_width
                else self._crop(resized, anchor_type)
            )
        else:  # ADAPTIVE
            # Crop if oversized (any amount), mirror-tile if undersized
            # Threshold determines the boundary for "significantly oversized"
            if new_width > self.target_width:
                return self._crop(resized, anchor_type)
            else:
                return self._mirror_tile(resized, anchor_type)

    def _crop(
        self,
        image: Image.Image,
        anchor_type: Literal["left", "center", "right"],
    ) -> Image.Image:
        """Crop image to target width, preserving anchor region.

        Strategy:
        - Left anchor: Crop from right (keep left side with text start)
        - Center anchor: Center crop (keep middle with centered text)
        - Right anchor: Crop from left (keep right side with text end)

        Args:
            image: Image to crop (width >= target_width)
            anchor_type: Caption anchor position

        Returns:
            Cropped image of width target_width
        """
        if image.width <= self.target_width:
            # Image already smaller than target, return as-is
            # (caller should use mirror-tile instead)
            return image

        if anchor_type == "left":
            # Crop from right side
            return image.crop((0, 0, self.target_width, self.target_height))
        elif anchor_type == "right":
            # Crop from left side
            left = image.width - self.target_width
            return image.crop((left, 0, image.width, self.target_height))
        else:  # center
            # Center crop
            left = (image.width - self.target_width) // 2
            return image.crop((left, 0, left + self.target_width, self.target_height))

    def _mirror_tile(
        self,
        image: Image.Image,
        anchor_type: Literal["left", "center", "right"],
    ) -> Image.Image:
        """Mirror-tile image to target width, filling away from anchor.

        Strategy:
        - Left anchor: Place image at left, mirror-tile to fill RIGHT
        - Right anchor: Place image at right, mirror-tile to fill LEFT
        - Center anchor: Place image at center, mirror-tile BOTH sides

        The mirror-tiling creates a smooth extension by reflecting the image.
        This is better than solid color padding because:
        1. Maintains visual continuity
        2. Provides context clues about text positioning
        3. Doesn't introduce artificial edges

        Args:
            image: Image to tile (width < target_width)
            anchor_type: Caption anchor position

        Returns:
            Tiled image of width target_width
        """
        # Create blank canvas
        canvas = Image.new("RGB", (self.target_width, self.target_height))

        if anchor_type == "left":
            # Place image at left, tile to fill right
            canvas.paste(image, (0, 0))
            self._fill_right(canvas, image, start_offset=image.width)

        elif anchor_type == "right":
            # Place image at right, tile to fill left
            left_offset = self.target_width - image.width
            canvas.paste(image, (left_offset, 0))
            self._fill_left(canvas, image, left_offset)

        else:  # center
            # Place image at center, tile both sides
            center_offset = (self.target_width - image.width) // 2
            canvas.paste(image, (center_offset, 0))
            self._fill_both_sides(canvas, image, center_offset)

        return canvas

    def _fill_right(
        self, canvas: Image.Image, source: Image.Image, start_offset: int
    ) -> None:
        """Fill right side of canvas with mirrored source image.

        Args:
            canvas: Canvas to fill (modified in-place)
            source: Source image to mirror
            start_offset: Starting x position for filling
        """
        filled = start_offset
        while filled < self.target_width:
            # Mirror the source image
            mirrored = source.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

            # Determine how much to paste
            remaining = self.target_width - filled
            paste_width = min(mirrored.width, remaining)

            # Crop if needed
            if paste_width < mirrored.width:
                mirrored = mirrored.crop((0, 0, paste_width, self.target_height))

            # Paste mirrored section
            canvas.paste(mirrored, (filled, 0))
            filled += paste_width

    def _fill_left(
        self,
        canvas: Image.Image,
        source: Image.Image,
        source_left: int,
    ) -> None:
        """Fill left side of canvas with mirrored source image.

        Args:
            canvas: Canvas to fill (modified in-place)
            source: Source image to mirror
            source_left: Left offset where source was pasted
        """
        filled_left = source_left
        while filled_left > 0:
            # Mirror the source image
            mirrored = source.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

            # Determine how much to paste
            paste_width = min(mirrored.width, filled_left)

            # Crop if needed (from right side when filling left)
            if paste_width < mirrored.width:
                crop_left = mirrored.width - paste_width
                mirrored = mirrored.crop(
                    (crop_left, 0, mirrored.width, self.target_height)
                )

            # Paste mirrored section
            paste_left = filled_left - paste_width
            canvas.paste(mirrored, (paste_left, 0))
            filled_left = paste_left

    def _fill_both_sides(
        self,
        canvas: Image.Image,
        source: Image.Image,
        source_left: int,
    ) -> None:
        """Fill both sides of canvas with mirrored source image.

        Args:
            canvas: Canvas to fill (modified in-place)
            source: Source image to mirror
            source_left: Left offset where source was pasted
        """
        # Fill right side
        self._fill_right(canvas, source, source_left + source.width)
        # Fill left side
        self._fill_left(canvas, source, source_left)


class NormalizeImageNet:
    """Normalize image using ImageNet statistics.

    ImageNet mean and std are standard for pre-trained vision models.
    """

    def __init__(self):
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def __call__(self, image: Image.Image) -> np.ndarray:
        """Normalize PIL image to numpy array.

        Args:
            image: PIL Image (RGB)

        Returns:
            Normalized numpy array of shape (C, H, W) in range [-1, 1]
        """
        # Convert to numpy array [0, 255] -> [0, 1]
        img_array = np.array(image, dtype=np.float32) / 255.0

        # Normalize using ImageNet statistics
        img_array = (img_array - self.mean) / self.std

        # Convert from (H, W, C) to (C, H, W) for PyTorch
        img_array = np.transpose(img_array, (2, 0, 1))

        return img_array
