"""OCR processing using macOS LiveText API.

This module re-exports OCR utilities from the shared ocr_utils package and provides
a specialized streaming OCR function for the caption_layout pipeline.
"""

import json
import time
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Optional

import ffmpeg
from ocr_utils import (
    OCRTimeoutError,
    create_ocr_visualization,
    process_frame_ocr_with_retry,
    process_frames_directory,
)

__all__ = [
    "OCRTimeoutError",
    "process_frame_ocr_with_retry",
    "process_frames_directory",
    "create_ocr_visualization",
    "stream_video_with_ocr",
]


def stream_video_with_ocr(
    video_path: Path,
    output_file: Path,
    frames_dir: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
    progress_callback: Optional[callable] = None,
    max_workers: int = 2,  # Use 2 workers so one stuck worker doesn't block everything
) -> None:
    """Extract frames from video and process with OCR in streaming fashion.

    Runs FFmpeg in background and processes frames as they become available,
    deleting each frame immediately after OCR completes. Uses worker pool
    for OCR processing to avoid overwhelming the OCR backend.

    This is a pipeline-specific function that combines video extraction with OCR processing.

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
            **{
                "q:v": 2,  # JPEG quality
                "fps_mode": "passthrough",  # Pass through timestamps without sync
                "frame_pts": "1",  # Use frame PTS for numbering
            },
        )
        .global_args("-fflags", "+genpts")  # Generate presentation timestamps
        .global_args("-flush_packets", "1")  # Flush packets immediately
        .overwrite_output()
        .run_async()
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
            ffmpeg_done = False

            # Process frames as they appear
            iteration = 0
            while True:
                iteration += 1

                # # Debug: Print status periodically or when stuck
                # if (current_count % 10 == 0 and len(futures) > 0) or (iteration % 100 == 0 and len(futures) > 0):
                #     print(f"DEBUG: {len(futures)} active futures, {len(pending_retries)} pending retries, {current_count} completed")
                #     for future, (fp, st, rc) in futures.items():
                #         elapsed = time.time() - st
                #         status = "STUCK!" if elapsed > 10 else ""
                #         print(f"  - {fp.name}: {elapsed:.1f}s elapsed, retry {rc} {status}")

                # Check for new frames
                frame_files = sorted(frames_dir.glob("frame_*.jpg"))
                new_frames = [frame for frame in frame_files if frame not in submitted_frames]

                # Submit new frames to worker pool (limit based on active futures)
                # Only submit if we have capacity to avoid blocking on a stuck worker
                max_active = max_workers * 3  # Allow small queue
                available_slots = max(0, max_active - len(futures))

                for frame_path in new_frames[:available_slots]:
                    # Submit to worker pool with retry logic
                    future = executor.submit(
                        process_frame_ocr_with_retry, frame_path, language
                    )
                    futures[future] = (frame_path, time.time(), 0)
                    submitted_frames.add(frame_path)

                # Check for frames ready to retry
                current_time = time.time()
                for frame_path in list(pending_retries.keys()):
                    retry_time, retry_count = pending_retries[frame_path]
                    if current_time >= retry_time:
                        # Resubmit frame
                        print(f"  Retrying {frame_path.name} (attempt {retry_count + 1}/{max_retries})...")
                        future = executor.submit(
                            process_frame_ocr_with_retry, frame_path, language
                        )
                        futures[future] = (frame_path, time.time(), retry_count)
                        del pending_retries[frame_path]

                # Collect and write completed results (non-blocking)
                for future in list(futures.keys()):
                    frame_path, submit_time, retry_count = futures[future]

                    # Check if future has been pending too long (15 seconds)
                    if time.time() - submit_time > worker_timeout:
                        print(f"\n{'='*80}")
                        print(f"TIMEOUT DETECTED: {frame_path.name} (attempt {retry_count + 1}/{max_retries})")
                        print(f"Elapsed: {time.time() - submit_time:.1f}s")
                        print(f"Worker hung - need to restart pool")
                        print(f"{'='*80}\n")

                        # Cancel doesn't work for running tasks - we need to restart the pool
                        # For now, mark as failed and continue
                        futures.pop(future)
                        try:
                            future.cancel()  # Try to cancel (only works if not started)
                        except:
                            pass

                        # Check if we should retry
                        if retry_count < max_retries - 1:
                            # Schedule retry with exponential backoff
                            backoff_delay = 1.0 * (2 ** retry_count)
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
                            progress_callback(current_count, expected_frames)
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
                                progress_callback(current_count, expected_frames)

                        except FuturesTimeoutError:
                            print(f"TIMEOUT getting result for {frame_path.name}")
                        except Exception as e:
                            print(f"UNEXPECTED ERROR: {frame_path.name}: {e}")

                # Check if FFmpeg has completed
                if not ffmpeg_done:
                    poll_result = ffmpeg_process.poll()
                    if poll_result is not None:
                        ffmpeg_done = True

                # Exit when FFmpeg is done and all futures are complete and no pending retries
                if ffmpeg_done and not futures and not pending_retries:
                    break

                # Small sleep to avoid busy-waiting
                time.sleep(0.1)

    # Check for FFmpeg errors
    if ffmpeg_process.returncode != 0:
        stderr = ffmpeg_process.stderr.read().decode() if ffmpeg_process.stderr else ""
        raise RuntimeError(f"FFmpeg failed: {stderr}")
