"""OCR processing using macOS LiveText API."""

import json
from collections import defaultdict
from pathlib import Path
from typing import Optional

from ocrmac import ocrmac
from PIL import Image


def process_frame_ocr(
    image_path: Path, language: str = "zh-Hans"
) -> dict[str, any]:
    """Run OCR on a single frame image.

    Args:
        image_path: Path to image file
        language: OCR language preference (default: "zh-Hans" for Simplified Chinese)

    Returns:
        Dictionary with OCR results
    """
    annotations = ocrmac.OCR(
        str(image_path), framework="livetext", language_preference=[language]
    ).recognize()

    return {
        "image_path": str(image_path.relative_to(image_path.parent.parent)),
        "framework": "livetext",
        "language_preference": language,
        "annotations": annotations,
    }


def process_frames_directory(
    frames_dir: Path,
    output_file: Path,
    language: str = "zh-Hans",
    progress_callback: Optional[callable] = None,
) -> list[dict]:
    """Process all frames in a directory with OCR.

    Args:
        frames_dir: Directory containing frame images
        output_file: Path to output JSONL file
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None

    Returns:
        List of OCR result dictionaries
    """
    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise FileNotFoundError(f"No frame images found in {frames_dir}")

    results = []
    total = len(frame_files)

    # Process each frame
    for idx, frame_path in enumerate(frame_files, 1):
        result = process_frame_ocr(frame_path, language)
        results.append(result)

        if progress_callback:
            progress_callback(idx, total)

    # Write to JSONL file
    with output_file.open("w") as f:
        for result in results:
            json.dump(result, f, ensure_ascii=False)
            f.write("\n")

    return results


def create_ocr_visualization(
    ocr_results: list[dict], output_image: Path, frames_dir: Path
) -> None:
    """Create visualization of OCR bounding boxes.

    Creates a white canvas showing all detected text boxes from all frames.
    Boxes are drawn with thin lines that accumulate darkness where they overlap.
    Filters out watermarks (text appearing in >80% of frames).

    Args:
        ocr_results: List of OCR result dictionaries from process_frames_directory
        output_image: Path to save visualization PNG
        frames_dir: Directory containing source frames
    """
    if not ocr_results:
        return

    # Get frame dimensions from first frame
    first_result = ocr_results[0]
    first_frame_path = frames_dir / Path(first_result["image_path"]).name

    if not first_frame_path.exists():
        first_frame_path = frames_dir / first_result["image_path"]

    # Open the reference image to get its dimensions
    with Image.open(first_frame_path) as img:
        width, height = img.size

    # Create a blank white image with the same dimensions
    blank_image = Image.new("RGB", (width, height), "white")

    # Track text occurrences to filter out constant elements
    text_occurrences = defaultdict(int)
    frame_count = len(ocr_results)

    # First pass: count text occurrences
    for frame in ocr_results:
        for annotation in frame["annotations"]:
            text = annotation[0]
            text_occurrences[text] += 1

    # Second pass: draw boxes, filtering constant text
    darkness = 5

    for frame in ocr_results:
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
                r, g, b = blank_image.getpixel((i, y1))
                blank_image.putpixel(
                    (i, y1),
                    (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                )

            # Bottom edge
            for i in range(x1, x2 + 1):
                r, g, b = blank_image.getpixel((i, y2))
                blank_image.putpixel(
                    (i, y2),
                    (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                )

            # Left edge
            for i in range(y1, y2 + 1):
                r, g, b = blank_image.getpixel((x1, i))
                blank_image.putpixel(
                    (x1, i),
                    (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                )

            # Right edge
            for i in range(y1, y2 + 1):
                r, g, b = blank_image.getpixel((x2, i))
                blank_image.putpixel(
                    (x2, i),
                    (max(0, r - darkness), max(0, g - darkness), max(0, b - darkness)),
                )

    # Save the resulting image
    blank_image.save(str(output_image))
