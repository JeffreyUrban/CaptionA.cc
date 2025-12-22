"""Core logic for caption frame extraction and processing.

This module provides both streaming and batch processing modes:
- Streaming: Process frames as they're extracted (lower disk usage)
- Batch: Extract all frames first, then process (simpler but uses more disk)
"""

from pathlib import Path
from typing import Optional

from caption_models import load_analysis_text
from image_utils import resize_directory
from video_utils import extract_frames, get_video_dimensions

from .streaming import stream_extract_and_resize, stream_extract_frames


def extract_frames_from_episode(
    episode_dir: Path,
    video_filename: str,
    analysis_filename: str,
    output_subdir: str,
    rate_hz: float = 10.0,
    progress_callback: Optional[callable] = None,
) -> tuple[Path, int]:
    """Extract frames from video with cropping based on subtitle analysis.

    Args:
        episode_dir: Directory containing video and analysis files
        video_filename: Name of video file in episode directory
        analysis_filename: Name of subtitle_analysis.txt file (e.g., "subtitle_analysis.txt")
        output_subdir: Subdirectory name for output frames (e.g., "10Hz_cropped_frames")
        rate_hz: Frame sampling rate in Hz (default: 10.0)
        progress_callback: Optional callback function (current, total) -> None

    Returns:
        Tuple of (output_dir, num_frames)

    Raises:
        FileNotFoundError: If video or analysis file not found
        ValueError: If analysis file is invalid
    """
    video_path = episode_dir / video_filename
    analysis_path = episode_dir / analysis_filename
    output_dir = episode_dir / output_subdir

    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not analysis_path.exists():
        raise FileNotFoundError(f"Analysis file not found: {analysis_path}")

    # Load subtitle region analysis
    region = load_analysis_text(analysis_path)

    # Get video dimensions to convert fractional bounds to pixels
    width, height = get_video_dimensions(video_path)

    # Convert fractional crop bounds to pixel coordinates
    # region.crop_* are fractional (0-1), need to convert to pixels
    x = int(region.crop_left * width)
    y = int(region.crop_top * height)
    crop_width = int((region.crop_right - region.crop_left) * width)
    crop_height = int((region.crop_bottom - region.crop_top) * height)

    crop_box = (x, y, crop_width, crop_height)

    # Extract frames with cropping
    frames = extract_frames(
        video_path,
        output_dir,
        rate_hz=rate_hz,
        crop_box=crop_box,
        progress_callback=progress_callback,
    )

    return output_dir, len(frames)


def resize_frames_in_directory(
    episode_dir: Path,
    input_subdir: str,
    output_subdir: str,
    target_width: int,
    target_height: int,
    preserve_aspect: bool = False,
    progress_callback: Optional[callable] = None,
) -> tuple[Path, int]:
    """Resize all frames in a directory to fixed dimensions.

    Args:
        episode_dir: Episode directory containing frames
        input_subdir: Subdirectory name containing input frames (e.g., "10Hz_cropped_frames")
        output_subdir: Subdirectory name for output frames (e.g., "10Hz_480x48_frames")
        target_width: Target width in pixels
        target_height: Target height in pixels
        preserve_aspect: If True, maintain aspect ratio with padding (default: False, stretch to fill)
        progress_callback: Optional callback function (current, total) -> None

    Returns:
        Tuple of (output_dir, num_frames)

    Raises:
        FileNotFoundError: If input directory not found
    """
    input_dir = episode_dir / input_subdir
    output_dir = episode_dir / output_subdir

    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")

    # Resize all frames
    resized_files = resize_directory(
        input_dir,
        output_dir,
        target_size=(target_width, target_height),
        pattern="frame_*.jpg",
        preserve_aspect=preserve_aspect,
        progress_callback=progress_callback,
    )

    return output_dir, len(resized_files)
