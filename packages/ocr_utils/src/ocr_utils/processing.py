"""OCR processing using macOS LiveText API with retry logic."""

import json
import signal
import time
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any, Optional

# Import ocrmac only on macOS (graceful failure on other platforms)
try:
    from ocrmac import ocrmac
except ImportError:
    ocrmac = None  # type: ignore[assignment]


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
) -> dict[str, Any]:
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

    Raises:
        RuntimeError: If ocrmac is not available (non-macOS platform)
    """
    if ocrmac is None:
        raise RuntimeError(
            "ocrmac is not available on this platform. "
            "This function requires macOS with the ocrmac package installed."
        )

    last_error = None

    for attempt in range(max_retries):
        # Set up timeout alarm (works in worker process)
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(timeout)

        try:
            annotations = ocrmac.OCR(str(image_path), framework="livetext", language_preference=[language]).recognize()

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
    progress_callback: Callable[[int, int], None] | None = None,
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

    Raises:
        RuntimeError: If ocrmac is not available (non-macOS platform)
    """
    if ocrmac is None:
        raise RuntimeError(
            "ocrmac is not available on this platform. "
            "This function requires macOS with the ocrmac package installed."
        )

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


def process_frames_streaming(
    frames_dir: Path,
    output_file: Path,
    language: str = "zh-Hans",
    max_workers: int = 1,
    progress_callback: Callable[[int, int | None], None] | None = None,
    check_interval: float = 0.1,
    ffmpeg_running_check: Callable[[], bool] | None = None,
) -> None:
    """Process frames as they appear in directory with OCR using worker pool.

    Watches directory for new frames and processes them as they're created.
    Designed to work with streaming frame extraction (e.g., from FFmpeg).
    Frames are deleted after successful processing.

    Args:
        frames_dir: Directory to watch for frame images
        output_file: Path to output JSONL file
        language: OCR language preference (default: "zh-Hans")
        max_workers: Maximum concurrent OCR workers (default: 1)
        progress_callback: Optional callback (current, total) -> None
        check_interval: How often to check for new frames (seconds)
        ffmpeg_running_check: Optional callable that returns True if extraction still running

    Raises:
        RuntimeError: If ocrmac is not available (non-macOS platform)

    Example:
        >>> process_frames_streaming(
        ...     frames_dir=Path("frames/"),
        ...     output_file=Path("output.jsonl"),
        ...     language="zh-Hans",
        ...     max_workers=2,
        ...     ffmpeg_running_check=lambda: ffmpeg_proc.poll() is None
        ... )
    """
    if ocrmac is None:
        raise RuntimeError(
            "ocrmac is not available on this platform. "
            "This function requires macOS with the ocrmac package installed."
        )

    submitted_frames = set()  # Frames submitted to workers
    pending_retries = {}  # frame_path -> (retry_time, retry_count)
    current_count = 0
    max_retries = 3
    worker_timeout = 15  # seconds - detect stuck workers quickly

    # Open output file for streaming writes
    with output_file.open("w") as f:
        # Create process pool
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {}  # future -> (frame_path, submit_time, retry_count) mapping
            extraction_done = False

            # Process frames as they appear
            while True:
                # Check if extraction is still running
                if ffmpeg_running_check and not extraction_done:
                    extraction_done = not ffmpeg_running_check()

                # Check for new frames
                frame_files = sorted(frames_dir.glob("frame_*.jpg"))
                new_frames = [frame for frame in frame_files if frame not in submitted_frames]

                # Submit new frames to worker pool (limit based on active futures)
                max_active = max_workers * 3  # Allow small queue
                available_slots = max(0, max_active - len(futures))

                for frame_path in new_frames[:available_slots]:
                    # Submit to worker pool
                    future = executor.submit(process_frame_ocr_with_retry, frame_path, language)
                    futures[future] = (frame_path, time.time(), 0)
                    submitted_frames.add(frame_path)

                # Check for frames ready to retry
                current_time = time.time()
                for frame_path in list(pending_retries.keys()):
                    retry_time, retry_count = pending_retries[frame_path]
                    if current_time >= retry_time:
                        # Resubmit frame
                        print(f"  Retrying {frame_path.name} (attempt {retry_count + 1}/{max_retries})...")
                        future = executor.submit(process_frame_ocr_with_retry, frame_path, language)
                        futures[future] = (frame_path, time.time(), retry_count)
                        del pending_retries[frame_path]

                # Collect and write completed results (non-blocking)
                for future in list(futures.keys()):
                    frame_path, submit_time, retry_count = futures[future]

                    # Check if future has been pending too long
                    if time.time() - submit_time > worker_timeout:
                        print(f"\n{'=' * 80}")
                        print(f"TIMEOUT DETECTED: {frame_path.name} (attempt {retry_count + 1}/{max_retries})")
                        print(f"Elapsed: {time.time() - submit_time:.1f}s")
                        print("Worker hung - cancelling")
                        print(f"{'=' * 80}\n")

                        futures.pop(future)
                        try:
                            future.cancel()  # Try to cancel (only works if not started)
                        except Exception:
                            pass

                        # Check if we should retry
                        if retry_count < max_retries - 1:
                            # Schedule retry with exponential backoff
                            backoff_delay = 1.0 * (2**retry_count)
                            retry_time = time.time() + backoff_delay
                            pending_retries[frame_path] = (retry_time, retry_count + 1)
                            print(f"  Will retry after {backoff_delay}s backoff...")
                            continue

                        # All retries exhausted - write error result
                        print(f"ERROR: OCR worker failed on {frame_path.name} after {max_retries} timeout attempts")
                        error_result = {
                            "image_path": str(frame_path.relative_to(frame_path.parent.parent)),
                            "framework": "livetext",
                            "language_preference": language,
                            "annotations": [],
                            "error": f"worker_timeout_after_{max_retries}_attempts",
                        }
                        json.dump(error_result, f, ensure_ascii=False)
                        f.write("\n")
                        f.flush()

                        # Delete frame
                        if frame_path.exists():
                            frame_path.unlink()

                        # Update progress
                        current_count += 1
                        if progress_callback:
                            progress_callback(current_count, None)
                        continue

                    if future.done():
                        futures.pop(future)
                        try:
                            result = future.result(timeout=1)

                            # Write result immediately
                            json.dump(result, f, ensure_ascii=False)
                            f.write("\n")
                            f.flush()

                            # Delete frame
                            frame_path.unlink()

                            # Update progress
                            current_count += 1
                            if progress_callback:
                                progress_callback(current_count, None)

                        except FuturesTimeoutError:
                            print(f"TIMEOUT getting result for {frame_path.name}")
                        except Exception as e:
                            print(f"UNEXPECTED ERROR: {frame_path.name}: {e}")

                # Exit when extraction is done and all futures are complete and no pending retries
                if extraction_done and not futures and not pending_retries:
                    break

                # Small sleep to avoid busy-waiting
                time.sleep(check_interval)
