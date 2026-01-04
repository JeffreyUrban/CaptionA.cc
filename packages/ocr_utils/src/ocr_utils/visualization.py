"""OCR visualization utilities."""

import json
from collections import defaultdict
from pathlib import Path
from typing import cast

from PIL import Image


def create_ocr_visualization(ocr_file: Path, output_image: Path, width: int, height: int) -> None:
    """Create visualization of OCR bounding boxes.

    Creates a white canvas showing all detected text boxes from all frames.
    Boxes are drawn with thin lines that accumulate darkness where they overlap.
    Filters out watermarks (text appearing in >80% of frames).

    Streams from JSONL file without loading all results into memory.

    Args:
        ocr_file: Path to OCR.jsonl file
        output_image: Path to save visualization PNG
        width: Video frame width in pixels
        height: Video frame height in pixels
    """
    # First pass: count text occurrences
    text_occurrences = defaultdict(int)
    frame_count = 0

    with ocr_file.open("r") as f:
        for line in f:
            if not line.strip():
                continue
            frame = json.loads(line)
            frame_count += 1

            # Count text occurrences
            for annotation in frame["annotations"]:
                text = annotation[0]
                text_occurrences[text] += 1

    if frame_count == 0:
        return

    # Create a blank white image with the same dimensions
    blank_image = Image.new("RGB", (width, height), "white")

    # Second pass: draw boxes, filtering constant text
    darkness = 5

    with ocr_file.open("r") as f:
        for line in f:
            if not line.strip():
                continue
            frame = json.loads(line)

            for annotation in frame["annotations"]:
                text = annotation[0]
                bbox = annotation[2]

                # Filter out text that appears in more than 80% of frames (likely watermarks/logos)
                if text_occurrences[text] > 0.8 * frame_count:
                    continue

                x, y, w, h = bbox
                # Convert normalized coordinates to pixel coordinates if needed
                x1 = int(x * width) if x <= 1 else int(x)
                y1 = height - (int((y + h) * height) if y + h <= 1 else int(y + h))
                x2 = int((x + w) * width) if x + w <= 1 else int(x + w)
                y2 = height - (int(y * height) if y <= 1 else int(y))

                # Bound coordinates to be within the image
                x1 = max(0, min(x1, width - 1))
                y1 = max(0, min(y1, height - 1))
                x2 = max(0, min(x2, width - 1))
                y2 = max(0, min(y2, height - 1))

                # Draw each edge of the rectangle separately with a dark color
                # Top edge
                for i in range(x1, x2 + 1):
                    r, g, b = cast(tuple[int, int, int], blank_image.getpixel((i, y1)))
                    blank_image.putpixel(
                        (i, y1),
                        (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                    )

                # Bottom edge
                for i in range(x1, x2 + 1):
                    r, g, b = cast(tuple[int, int, int], blank_image.getpixel((i, y2)))
                    blank_image.putpixel(
                        (i, y2),
                        (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                    )

                # Left edge
                for i in range(y1, y2 + 1):
                    r, g, b = cast(tuple[int, int, int], blank_image.getpixel((x1, i)))
                    blank_image.putpixel(
                        (x1, i),
                        (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                    )

                # Right edge
                for i in range(y1, y2 + 1):
                    r, g, b = cast(tuple[int, int, int], blank_image.getpixel((x2, i)))
                    blank_image.putpixel(
                        (x2, i),
                        (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                    )

    # Save the resulting image
    blank_image.save(str(output_image))
