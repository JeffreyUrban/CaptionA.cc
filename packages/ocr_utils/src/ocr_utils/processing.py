"""OCR processing using macOS LiveText API with retry logic."""

import json
import signal
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

from ocrmac import ocrmac


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

        except OCRTimeoutError:
            # Cancel the alarm
            signal.alarm(0)
            last_error = "timeout"
            print(f"  OCR timeout on {image_path.name} (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                backoff_delay = base_backoff * (2**attempt)
                print(f"  Retrying after {backoff_delay}s backoff...")
                time.sleep(backoff_delay)
            continue

        except Exception as e:
            # Cancel the alarm on any error
            signal.alarm(0)
            last_error = str(e)
            print(f"  OCR error on {image_path.name} (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                backoff_delay = base_backoff * (2**attempt)
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
                executor.submit(process_frame_ocr_with_retry, frame_path, language): (
                    idx,
                    frame_path,
                )
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
