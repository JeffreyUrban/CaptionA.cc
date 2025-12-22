"""OCR processing using macOS LiveText API."""

import json
import subprocess
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

import ffmpeg
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
    keep_frames: bool = False,
) -> Path:
    """Process all frames in a directory with OCR.

    Streams results directly to JSONL file without accumulating in memory.
    Deletes frames after processing unless keep_frames=True.

    Args:
        frames_dir: Directory containing frame images
        output_file: Path to output JSONL file
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        keep_frames: If True, keep frames after processing. If False, delete them.

    Returns:
        Path to the first frame (kept for visualization)
    """
    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise FileNotFoundError(f"No frame images found in {frames_dir}")

    total = len(frame_files)
    first_frame = frame_files[0]

    # Open output file and process each frame, writing immediately
    with output_file.open("w") as f:
        for idx, frame_path in enumerate(frame_files, 1):
            result = process_frame_ocr(frame_path, language)
            json.dump(result, f, ensure_ascii=False)
            f.write("\n")

            # Delete frame after processing (except first frame, needed for dimensions)
            if not keep_frames and idx > 1:
                frame_path.unlink()

            if progress_callback:
                progress_callback(idx, total)

    return first_frame


def stream_video_with_ocr(
    video_path: Path,
    output_file: Path,
    frames_dir: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
    progress_callback: Optional[callable] = None,
) -> None:
    """Extract frames from video and process with OCR in streaming fashion.

    Runs FFmpeg in background and processes frames as they become available,
    deleting each frame immediately after OCR completes. Achieves constant
    memory usage with no disk accumulation.

    Args:
        video_path: Path to input video file
        output_file: Path to output JSONL file
        frames_dir: Directory for temporary frame storage
        rate_hz: Frame sampling rate in Hz (default: 0.1)
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
    """
    # Create frames directory
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Get expected frame count
    probe = ffmpeg.probe(str(video_path))
    duration = float(probe["format"]["duration"])
    expected_frames = int(duration * rate_hz)

    # Start FFmpeg extraction in background
    output_pattern = frames_dir / "frame_%010d.jpg"
    ffmpeg_process = (
        ffmpeg.input(str(video_path))
        .filter("fps", fps=rate_hz)
        .output(
            str(output_pattern),
            format="image2",
            **{"q:v": 2},
        )
        .overwrite_output()
        .run_async(pipe_stdout=True, pipe_stderr=True)
    )

    processed_frames = set()
    current_count = 0

    # Open output file for streaming writes
    with output_file.open("w") as f:
        # Process frames as they appear
        while True:
            # Check for new frames
            frame_files = sorted(frames_dir.glob("frame_*.jpg"))
            new_frames = [
                frame for frame in frame_files if frame not in processed_frames
            ]

            # Process any new frames
            for frame_path in new_frames:
                # Wait a moment to ensure file is fully written
                time.sleep(0.1)

                # Process with OCR
                result = process_frame_ocr(frame_path, language)
                json.dump(result, f, ensure_ascii=False)
                f.write("\n")
                f.flush()  # Ensure immediate write

                # Delete frame immediately
                frame_path.unlink()

                # Track progress
                processed_frames.add(frame_path)
                current_count += 1
                if progress_callback:
                    progress_callback(current_count, expected_frames)

            # Check if FFmpeg has completed
            poll_result = ffmpeg_process.poll()
            if poll_result is not None:
                # FFmpeg finished - process any remaining frames
                frame_files = sorted(frames_dir.glob("frame_*.jpg"))
                remaining_frames = [
                    frame for frame in frame_files if frame not in processed_frames
                ]

                for frame_path in remaining_frames:
                    result = process_frame_ocr(frame_path, language)
                    json.dump(result, f, ensure_ascii=False)
                    f.write("\n")
                    f.flush()

                    frame_path.unlink()

                    processed_frames.add(frame_path)
                    current_count += 1
                    if progress_callback:
                        progress_callback(current_count, expected_frames)

                break

            # Small sleep to avoid busy-waiting
            time.sleep(0.5)

    # Check for FFmpeg errors
    if ffmpeg_process.returncode != 0:
        stderr = ffmpeg_process.stderr.read().decode() if ffmpeg_process.stderr else ""
        raise RuntimeError(f"FFmpeg failed: {stderr}")


def create_ocr_visualization(
    ocr_file: Path, output_image: Path, width: int, height: int
) -> None:
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
