"""OCR processing using macOS LiveText API."""

import json
import signal
import subprocess
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, TimeoutError, as_completed
from pathlib import Path
from typing import Optional

import ffmpeg
from ocrmac import ocrmac
from PIL import Image


class OCRTimeoutError(Exception):
    """Raised when OCR processing times out."""
    pass


def timeout_handler(signum, frame):
    """Signal handler for OCR timeout."""
    raise OCRTimeoutError("OCR processing timed out")


def process_frame_ocr_with_retry(
    image_path: Path,
    language: str = "zh-Hans",
    timeout: int = 10,
    max_retries: int = 3,
    base_backoff: float = 1.0,
) -> dict[str, any]:
    """Run OCR on a single frame with timeout protection and retry logic.

    This function runs in a worker process and uses signal.alarm() for timeout.
    Uses exponential backoff between retries.

    Args:
        image_path: Path to image file
        language: OCR language preference (default: "zh-Hans" for Simplified Chinese)
        timeout: Maximum seconds to wait per attempt (default: 10)
        max_retries: Maximum retry attempts (default: 3)
        base_backoff: Base delay for exponential backoff in seconds (default: 1.0)

    Returns:
        Dictionary with OCR results
    """
    last_error = None

    for attempt in range(max_retries):
        # Set up timeout alarm (works in worker process)
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(timeout)

        try:
            annotations = ocrmac.OCR(
                str(image_path), framework="livetext", language_preference=[language]
            ).recognize()

            # Cancel the alarm
            signal.alarm(0)

            if attempt > 0:
                print(f"  OCR succeeded on {image_path.name} after {attempt + 1} attempts")

            return {
                "image_path": str(image_path.relative_to(image_path.parent.parent)),
                "framework": "livetext",
                "language_preference": language,
                "annotations": annotations,
            }

        except OCRTimeoutError as e:
            # Cancel the alarm
            signal.alarm(0)
            last_error = "timeout"
            print(f"  OCR timeout on {image_path.name} (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                backoff_delay = base_backoff * (2 ** attempt)
                print(f"  Retrying after {backoff_delay}s backoff...")
                time.sleep(backoff_delay)
            continue

        except Exception as e:
            # Cancel the alarm on any error
            signal.alarm(0)
            last_error = str(e)
            print(f"  OCR error on {image_path.name} (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                backoff_delay = base_backoff * (2 ** attempt)
                print(f"  Retrying after {backoff_delay}s backoff...")
                time.sleep(backoff_delay)
            continue

    # All retries exhausted
    print(f"ERROR: OCR failed on {image_path.name} after {max_retries} attempts")
    return {
        "image_path": str(image_path.relative_to(image_path.parent.parent)),
        "framework": "livetext",
        "language_preference": language,
        "annotations": [],
        "error": f"failed_after_{max_retries}_attempts: {last_error}",
    }


def process_frames_directory(
    frames_dir: Path,
    output_file: Path,
    language: str = "zh-Hans",
    progress_callback: Optional[callable] = None,
    keep_frames: bool = False,
    max_workers: int = 1,
) -> Path:
    """Process all frames in a directory with OCR using worker pool.

    Streams results directly to JSONL file without accumulating in memory.
    Deletes frames after processing unless keep_frames=True.

    Args:
        frames_dir: Directory containing frame images
        output_file: Path to output JSONL file
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        keep_frames: If True, keep frames after processing. If False, delete them.
        max_workers: Maximum concurrent OCR workers (default: 1 for macOS OCR)

    Returns:
        Path to the first frame (kept for visualization)
    """
    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise FileNotFoundError(f"No frame images found in {frames_dir}")

    total = len(frame_files)
    first_frame = frame_files[0]

    # Open output file and process with worker pool
    with output_file.open("w") as f:
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            # Submit all frames to worker pool
            futures = {
                executor.submit(process_frame_ocr_with_retry, frame_path, language): (idx, frame_path)
                for idx, frame_path in enumerate(frame_files, 1)
            }

            # Collect and write results as they complete
            completed_count = 0
            for future in as_completed(futures):
                idx, frame_path = futures[future]
                try:
                    result = future.result()

                    # Write result immediately
                    json.dump(result, f, ensure_ascii=False)
                    f.write("\n")

                    # Delete frame after processing (except first frame)
                    if not keep_frames and idx > 1:
                        frame_path.unlink()

                    completed_count += 1
                    if progress_callback:
                        progress_callback(completed_count, total)

                except Exception as e:
                    print(f"UNEXPECTED ERROR: {frame_path.name}: {e}")

    return first_frame


def stream_video_with_ocr(
    video_path: Path,
    output_file: Path,
    frames_dir: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
    progress_callback: Optional[callable] = None,
    max_workers: int = 1,
) -> None:
    """Extract frames from video and process with OCR in streaming fashion.

    Runs FFmpeg in background and processes frames as they become available,
    deleting each frame immediately after OCR completes. Uses worker pool
    for OCR processing to avoid overwhelming the OCR backend.

    Args:
        video_path: Path to input video file
        output_file: Path to output JSONL file
        frames_dir: Directory for temporary frame storage
        rate_hz: Frame sampling rate in Hz (default: 0.1)
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        max_workers: Maximum concurrent OCR workers (default: 1 for macOS OCR)
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

    submitted_frames = set()  # Frames submitted to workers
    current_count = 0

    # Open output file for streaming writes
    with output_file.open("w") as f:
        # Create process pool
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {}  # future -> frame_path mapping
            ffmpeg_done = False

            # Process frames as they appear
            while True:
                # Check for new frames
                frame_files = sorted(frames_dir.glob("frame_*.jpg"))
                new_frames = [
                    frame for frame in frame_files if frame not in submitted_frames
                ]

                # Submit new frames to worker pool
                for frame_path in new_frames:
                    # Wait a moment to ensure file is fully written
                    time.sleep(0.1)

                    # Submit to worker pool with retry logic
                    future = executor.submit(process_frame_ocr_with_retry, frame_path, language)
                    futures[future] = frame_path
                    submitted_frames.add(frame_path)

                # Collect and write completed results (non-blocking)
                for future in list(futures.keys()):
                    if future.done():
                        frame_path = futures.pop(future)
                        try:
                            result = future.result()

                            # Write result immediately
                            json.dump(result, f, ensure_ascii=False)
                            f.write("\n")
                            f.flush()

                            # Delete frame
                            frame_path.unlink()

                            # Update progress
                            current_count += 1
                            if progress_callback:
                                progress_callback(current_count, expected_frames)

                        except Exception as e:
                            print(f"UNEXPECTED ERROR: {frame_path.name}: {e}")

                # Check if FFmpeg has completed
                if not ffmpeg_done:
                    poll_result = ffmpeg_process.poll()
                    if poll_result is not None:
                        ffmpeg_done = True

                # Exit when FFmpeg is done and all futures are complete
                if ffmpeg_done and not futures:
                    break

                # Small sleep to avoid busy-waiting
                time.sleep(0.1)

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
