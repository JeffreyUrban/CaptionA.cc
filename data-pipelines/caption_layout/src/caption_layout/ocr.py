"""OCR processing using macOS LiveText API.

This module re-exports OCR utilities from the shared ocr_utils package and provides
a specialized streaming OCR function for the caption_layout pipeline.
"""

from pathlib import Path
from typing import Optional

from ocr_utils import (
    OCRTimeoutError,
    create_ocr_visualization,
    process_frame_ocr_with_retry,
    process_frames_directory,
    process_frames_streaming,
)
from video_utils import extract_frames_streaming, get_video_duration

__all__ = [
    "OCRTimeoutError",
    "process_frame_ocr_with_retry",
    "process_frames_directory",
    "process_frames_streaming",
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
    max_workers: int = 2,
) -> None:
    """Extract frames from video and process with OCR in streaming fashion.

    Runs FFmpeg in background and processes frames as they become available,
    deleting each frame immediately after OCR completes. Uses worker pool
    for OCR processing to avoid overwhelming the OCR backend.

    This is a thin orchestration layer that combines shared video_utils and
    ocr_utils streaming functions.

    Args:
        video_path: Path to input video file
        output_file: Path to output JSONL file
        frames_dir: Directory for temporary frame storage
        rate_hz: Frame sampling rate in Hz (default: 0.1)
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        max_workers: Maximum concurrent OCR workers (default: 2)
    """
    # Create frames directory
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Start FFmpeg extraction in background
    ffmpeg_process = extract_frames_streaming(
        video_path=video_path,
        output_dir=frames_dir,
        rate_hz=rate_hz,
    )

    # Process frames as they appear
    # The streaming processor will exit when FFmpeg completes and all frames are processed
    process_frames_streaming(
        frames_dir=frames_dir,
        output_file=output_file,
        language=language,
        max_workers=max_workers,
        progress_callback=progress_callback,
        ffmpeg_running_check=lambda: ffmpeg_process.poll() is None,
    )

    # Check for FFmpeg errors
    if ffmpeg_process.returncode != 0:
        raise RuntimeError(f"FFmpeg failed with return code {ffmpeg_process.returncode}")
