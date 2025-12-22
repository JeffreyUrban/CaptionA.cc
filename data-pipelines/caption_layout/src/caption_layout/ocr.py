"""OCR processing using macOS LiveText API.

This module re-exports OCR utilities from the shared ocr_utils package and provides
a specialized streaming OCR function for the caption_layout pipeline.
"""

import json
import time
from concurrent.futures import ProcessPoolExecutor
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
    max_workers: int = 1,
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
                new_frames = [frame for frame in frame_files if frame not in submitted_frames]

                # Submit new frames to worker pool
                for frame_path in new_frames:
                    # Wait a moment to ensure file is fully written
                    time.sleep(0.1)

                    # Submit to worker pool with retry logic
                    future = executor.submit(
                        process_frame_ocr_with_retry, frame_path, language
                    )
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
