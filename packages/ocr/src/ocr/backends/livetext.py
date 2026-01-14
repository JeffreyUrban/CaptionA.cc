"""macOS LiveText OCR backend using ocrmac."""

import io
import os
import tempfile
from pathlib import Path

from PIL import Image

from ..models import OCRResult, BoundingBox, CharacterResult
from .base import OCRBackend

# Import ocrmac only on macOS
try:
    from ocrmac import ocrmac

    OCRMAC_AVAILABLE = True
except ImportError:
    ocrmac = None
    OCRMAC_AVAILABLE = False


class LiveTextBackend(OCRBackend):
    """macOS LiveText backend using ocrmac library.

    This backend uses Apple's LiveText OCR framework via the ocrmac library.
    It requires macOS and the ocrmac package to be installed.

    The ocrmac library returns annotations in a specific format:
    - Coordinates are fractional (0.0-1.0)
    - Y-axis is bottom-referenced (0 = bottom, 1 = top)
    - Format: [text, confidence, [x, y, width, height]]

    This backend converts those to the standard OCRResult format with:
    - Pixel coordinates
    - Top-referenced Y-axis (0 = top)
    """

    def __init__(self):
        if not OCRMAC_AVAILABLE:
            raise RuntimeError(
                "ocrmac is not available. This backend requires macOS with ocrmac installed."
            )

    def get_constraints(self) -> dict:
        """Return LiveText constraints (fairly generous on macOS)."""
        return {
            "max_image_height": 100000,  # Very generous
            "max_image_width": 100000,
            "max_file_size_bytes": 100 * 1024 * 1024,  # 100MB
        }

    def process_single(self, image_bytes: bytes, language: str) -> OCRResult:
        """Process single image with macOS LiveText.

        Args:
            image_bytes: Image data as bytes
            language: Language preference (e.g., "en-US")

        Returns:
            OCRResult with character-level annotations

        Raises:
            RuntimeError: If OCR processing fails
        """
        # Get image dimensions from bytes
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image_width, image_height = image.size
        except Exception as e:
            raise RuntimeError(f"Failed to read image dimensions: {e}")

        # ocrmac.OCR requires a file path, so write to temp file
        temp_fd, temp_path = tempfile.mkstemp(suffix=".jpg")
        try:
            # Write image bytes to temp file
            Path(temp_path).write_bytes(image_bytes)

            # Call ocrmac with LiveText framework
            try:
                annotations = ocrmac.OCR(
                    temp_path, framework="livetext", language_preference=[language]
                ).recognize()
            except Exception as e:
                raise RuntimeError(f"OCR processing failed: {e}")

            # Convert annotations to OCRResult format
            characters = []
            for annotation in annotations:
                # Parse ocrmac annotation format: [text, confidence, [x, y, width, height]]
                text = annotation[0]
                # annotation[1] is confidence (unused in current implementation)
                coords = annotation[2]

                # Extract fractional, bottom-referenced coordinates
                x_frac = coords[0]
                y_frac_bottom = coords[1]
                width_frac = coords[2]
                height_frac = coords[3]

                # Convert to pixel coordinates
                x_pixel = int(x_frac * image_width)
                width_pixel = int(width_frac * image_width)
                height_pixel = int(height_frac * image_height)

                # Convert from bottom-referenced to top-referenced
                # In bottom-ref: y=0 is bottom, y increases upward
                # In top-ref: y=0 is top, y increases downward
                # Bottom of character in bottom-ref: y_frac_bottom
                # Bottom of character in pixels from top: (1 - y_frac_bottom) * image_height
                # Top of character in pixels from top: bottom - height
                y_pixel = int((1.0 - y_frac_bottom) * image_height) - height_pixel

                # Create character result
                bbox = BoundingBox(
                    x=x_pixel, y=y_pixel, width=width_pixel, height=height_pixel
                )
                characters.append(CharacterResult(text=text, bbox=bbox))

            # Extract full text from characters
            full_text = "".join(char.text for char in characters)

            # Return OCRResult
            # Note: 'id' will be set by the caller/processor
            return OCRResult(
                id="",  # Will be set by caller
                characters=characters,
                text=full_text,
                char_count=len(characters),
            )

        finally:
            # Clean up temp file
            os.close(temp_fd)
            Path(temp_path).unlink(missing_ok=True)
