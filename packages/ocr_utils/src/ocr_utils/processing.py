"""OCR processing using OCR service or macOS LiveText API fallback."""

import json
import signal
import time
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any, Literal

from .config import OCR_SERVICE_URL, USE_OCRMAC_FALLBACK
from .ocr_service_client import OCRServiceAdapter, OCRServiceError

# Import ocrmac only on macOS (graceful failure on other platforms)
try:
    from ocrmac import ocrmac  # type: ignore[reportMissingImports]
except ImportError:
    ocrmac = None  # type: ignore[assignment]

# Global OCR service adapter instance
_ocr_adapter = OCRServiceAdapter(service_url=OCR_SERVICE_URL)

# Backend selection cache
_selected_backend: Literal["ocr_service", "ocrmac"] | None = None


class OCRTimeoutError(Exception):
    """Raised when OCR processing times out."""

    pass


def timeout_handler(signum, frame):
    """Signal handler for OCR timeout."""
    raise OCRTimeoutError("OCR processing timed out")


def _get_ocr_backend() -> Literal["ocr_service", "ocrmac"]:
    """Determine which OCR backend to use.

    Only uses OCR service by default. Set USE_OCRMAC_FALLBACK=true environment
    variable to explicitly enable ocrmac fallback (macOS only).
    Caches the selection for the session.

    Returns:
        "ocr_service" or "ocrmac"

    Raises:
        RuntimeError: If OCR service is unavailable
    """
    global _selected_backend

    # Return cached selection
    if _selected_backend:
        return _selected_backend

    # If explicit fallback is enabled, check ocrmac first
    if USE_OCRMAC_FALLBACK:
        if ocrmac is not None:
            print("Using ocrmac backend (USE_OCRMAC_FALLBACK enabled)")
            _selected_backend = "ocrmac"
            return "ocrmac"
        else:
            print("Warning: USE_OCRMAC_FALLBACK enabled but ocrmac not available, trying OCR service")

    # Try OCR service
    if _ocr_adapter.health_check():
        print("Using OCR service backend")
        _selected_backend = "ocr_service"
        return "ocr_service"

    # No backend available
    raise RuntimeError(
        "OCR service unavailable. Please ensure the OCR service is running and accessible. "
        f"OCR_SERVICE_URL={OCR_SERVICE_URL}\n"
        f"Set USE_OCRMAC_FALLBACK=true to use ocrmac fallback on macOS (not recommended for production)."
    )


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
        RuntimeError: If no OCR backend is available
    """
    backend = _get_ocr_backend()

    if backend == "ocr_service":
        # Use OCR service adapter
        last_error = None
        for attempt in range(max_retries):
            try:
                # Process single frame using batch method
                results = _ocr_adapter.process_frames_batch([image_path], language)

                if attempt > 0:
                    print(f"  OCR succeeded on {image_path.name} after {attempt + 1} attempts")

                # Return first (and only) result
                return results[0]

            except OCRServiceError as e:
                last_error = str(e)
                print(f"  OCR service error on {image_path.name} (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    backoff_delay = base_backoff * (2**attempt)
                    print(f"  Retrying after {backoff_delay}s backoff...")
                    time.sleep(backoff_delay)
                continue

            except Exception as e:
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
            "annotations": [],
            "error": f"failed_after_{max_retries}_attempts: {last_error}",
        }

    else:  # ocrmac backend
        if ocrmac is None:
            raise RuntimeError(
                "ocrmac is not available on this platform. This function requires macOS with the ocrmac package installed."
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
    """Process all frames in a directory with OCR using worker pool or batching.

    Streams results directly to JSONL file without accumulating in memory.
    Deletes frames after processing unless keep_frames=True.

    When using OCR service backend, processes frames in batches for efficiency.
    When using ocrmac backend, uses worker pool as before.

    Args:
        frames_dir: Directory containing frame images
        output_file: Path to output JSONL file
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        keep_frames: If True, keep frames after processing. If False, delete them.
        max_workers: Maximum concurrent OCR workers (default: 1, ignored for OCR service)

    Returns:
        Path to the first frame (kept for visualization)

    Raises:
        RuntimeError: If no OCR backend is available
    """
    backend = _get_ocr_backend()

    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise FileNotFoundError(f"No frame images found in {frames_dir}")

    total = len(frame_files)
    first_frame = frame_files[0]

    if backend == "ocr_service":
        # Use batching with OCR service
        from PIL import Image

        # Get frame dimensions (assume all frames have same dimensions)
        with Image.open(first_frame) as img:
            batch_size = _ocr_adapter.calculate_batch_size(img.width, img.height)

        print(f"Processing {total} frames in batches of {batch_size}")

        # Open output file and process in batches
        with output_file.open("w") as f:
            completed_count = 0

            # Process in batches
            for batch_start in range(0, total, batch_size):
                batch_end = min(batch_start + batch_size, total)
                batch_frames = frame_files[batch_start:batch_end]
                batch_indices = list(range(batch_start + 1, batch_end + 1))

                print(f"Processing batch {batch_start // batch_size + 1}: frames {batch_start + 1}-{batch_end}")

                try:
                    # Process batch
                    results = _ocr_adapter.process_frames_batch(batch_frames, language)

                    # Write results
                    for idx, result in zip(batch_indices, results):
                        json.dump(result, f, ensure_ascii=False)
                        f.write("\n")

                        # Delete frame after processing (except first frame)
                        frame_path = batch_frames[idx - batch_start - 1]
                        if not keep_frames and idx > 1:
                            frame_path.unlink()

                        completed_count += 1
                        if progress_callback:
                            progress_callback(completed_count, total)

                except Exception as e:
                    print(f"ERROR processing batch: {e}")
                    # Write error results for this batch
                    for idx, frame_path in zip(batch_indices, batch_frames):
                        error_result = {
                            "image_path": str(frame_path.relative_to(frame_path.parent.parent)),
                            "framework": "livetext",
                            "annotations": [],
                            "error": f"batch_processing_error: {e}",
                        }
                        json.dump(error_result, f, ensure_ascii=False)
                        f.write("\n")

                        # Still delete frames even on error
                        if not keep_frames and idx > 1:
                            frame_path.unlink()

                        completed_count += 1
                        if progress_callback:
                            progress_callback(completed_count, total)

    else:  # ocrmac backend
        if ocrmac is None:
            raise RuntimeError(
                "ocrmac is not available on this platform. This function requires macOS with the ocrmac package installed."
            )

        # Use worker pool as before
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
    """Process frames as they appear in directory with OCR.

    Watches directory for new frames and processes them as they're created.
    Designed to work with streaming frame extraction (e.g., from FFmpeg).
    Frames are deleted after successful processing.

    When using OCR service backend, accumulates frames into batches.
    When using ocrmac backend, uses worker pool as before.

    Args:
        frames_dir: Directory to watch for frame images
        output_file: Path to output JSONL file
        language: OCR language preference (default: "zh-Hans")
        max_workers: Maximum concurrent OCR workers (default: 1, ignored for OCR service)
        progress_callback: Optional callback (current, total) -> None
        check_interval: How often to check for new frames (seconds)
        ffmpeg_running_check: Optional callable that returns True if extraction still running

    Raises:
        RuntimeError: If no OCR backend is available

    Example:
        >>> process_frames_streaming(
        ...     frames_dir=Path("frames/"),
        ...     output_file=Path("output.jsonl"),
        ...     language="zh-Hans",
        ...     max_workers=2,
        ...     ffmpeg_running_check=lambda: ffmpeg_proc.poll() is None
        ... )
    """
    backend = _get_ocr_backend()

    if backend == "ocr_service":
        # Use batching with OCR service
        _process_frames_streaming_batched(
            frames_dir, output_file, language, progress_callback, check_interval, ffmpeg_running_check
        )
    else:
        # Use ocrmac backend
        _process_frames_streaming_ocrmac(
            frames_dir, output_file, language, max_workers, progress_callback, check_interval, ffmpeg_running_check
        )


def _process_frames_streaming_batched(
    frames_dir: Path,
    output_file: Path,
    language: str,
    progress_callback: Callable[[int, int | None], None] | None,
    check_interval: float,
    ffmpeg_running_check: Callable[[], bool] | None,
) -> None:
    """Process frames with OCR service using adaptive batching."""
    from PIL import Image

    submitted_frames = set()
    current_count = 0
    batch_size = None  # Will be determined from first frame
    pending_batch = []  # Accumulate frames for next batch
    last_batch_time = time.time()
    batch_timeout = 2.0  # Submit batch if no new frames for 2 seconds

    with output_file.open("w") as f:
        extraction_done = False

        while True:
            # Check if extraction is still running
            if ffmpeg_running_check and not extraction_done:
                extraction_done = not ffmpeg_running_check()

            # Check for new frames
            frame_files = sorted(frames_dir.glob("frame_*.jpg"))
            new_frames = [frame for frame in frame_files if frame not in submitted_frames]

            # Determine batch size from first frame
            if batch_size is None and (new_frames or frame_files):
                first_frame = new_frames[0] if new_frames else frame_files[0]
                with Image.open(first_frame) as img:
                    batch_size = _ocr_adapter.calculate_batch_size(img.width, img.height)
                print(f"Using batch size: {batch_size}")

            # Add new frames to pending batch
            for frame_path in new_frames:
                pending_batch.append(frame_path)
                submitted_frames.add(frame_path)
                last_batch_time = time.time()

            # Decide whether to submit batch
            should_submit = False
            reason = "unknown"  # Default reason
            if batch_size is not None and len(pending_batch) >= batch_size:
                should_submit = True
                reason = "batch full"
            elif extraction_done and pending_batch:
                should_submit = True
                reason = "extraction done"
            elif pending_batch and (time.time() - last_batch_time > batch_timeout):
                should_submit = True
                reason = "timeout"

            # Submit batch if ready
            if should_submit and pending_batch and batch_size is not None:
                batch_frames = pending_batch[:batch_size]  # Take up to batch_size
                pending_batch = pending_batch[batch_size:]  # Keep remainder

                print(f"Submitting batch of {len(batch_frames)} frames ({reason})")

                try:
                    results = _ocr_adapter.process_frames_batch(batch_frames, language)

                    # Write results
                    for result, frame_path in zip(results, batch_frames):
                        json.dump(result, f, ensure_ascii=False)
                        f.write("\n")
                        f.flush()

                        # Delete frame
                        frame_path.unlink()

                        # Update progress
                        current_count += 1
                        if progress_callback:
                            progress_callback(current_count, None)

                except Exception as e:
                    print(f"ERROR processing batch: {e}")
                    # Write error results
                    for frame_path in batch_frames:
                        error_result = {
                            "image_path": str(frame_path.relative_to(frame_path.parent.parent)),
                            "framework": "livetext",
                            "annotations": [],
                            "error": f"batch_processing_error: {e}",
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

            # Exit when extraction is done and no pending frames
            if extraction_done and not pending_batch:
                break

            # Small sleep to avoid busy-waiting
            time.sleep(check_interval)


def _process_frames_streaming_ocrmac(
    frames_dir: Path,
    output_file: Path,
    language: str,
    max_workers: int,
    progress_callback: Callable[[int, int | None], None] | None,
    check_interval: float,
    ffmpeg_running_check: Callable[[], bool] | None,
) -> None:
    """Process frames with ocrmac using worker pool (original implementation)."""
    if ocrmac is None:
        raise RuntimeError(
            "ocrmac is not available on this platform. This function requires macOS with the ocrmac package installed."
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
