"""Frame extraction from video using FFmpeg."""

import subprocess
from collections.abc import Callable
from pathlib import Path

import ffmpeg


def get_video_duration(video_path: Path) -> float:
    """Get video duration in seconds using ffprobe.

    Args:
        video_path: Path to video file

    Returns:
        Duration in seconds

    Raises:
        RuntimeError: If ffprobe fails or duration cannot be determined
    """
    try:
        probe = ffmpeg.probe(str(video_path))
        duration = float(probe["format"]["duration"])
        return duration
    except (ffmpeg.Error, KeyError, ValueError) as e:
        raise RuntimeError(f"Failed to get video duration: {e}") from e


def extract_frames(
    video_path: Path,
    output_dir: Path,
    rate_hz: float = 0.1,
    crop_box: tuple[int, int, int, int] | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[Path]:
    """Extract frames from video at specified rate.

    Args:
        video_path: Path to input video file
        output_dir: Directory to save extracted frames
        rate_hz: Frame sampling rate in Hz (frames per second). Default: 0.1 (1 frame per 10 seconds)
        crop_box: Optional crop region as (x, y, width, height) in pixels. Cropping is applied before extraction.
        progress_callback: Optional callback function (current_frame, total_frames) -> None

    Returns:
        List of paths to extracted frame files

    Raises:
        RuntimeError: If FFmpeg fails
        FileNotFoundError: If FFmpeg is not installed
    """
    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Get video duration to calculate expected frame count
    duration = get_video_duration(video_path)
    expected_frames = int(duration * rate_hz)

    # FFmpeg command to extract frames
    # -r {rate_hz}: input frame rate (sample at this rate)
    # -q:v 2: JPEG quality (2 is high quality)
    # Output pattern: frame_%010d.jpg (zero-padded to 10 digits)
    output_pattern = output_dir / "frame_%010d.jpg"

    try:
        stream = ffmpeg.input(str(video_path))

        # Apply crop filter if specified
        if crop_box is not None:
            x, y, width, height = crop_box
            stream = stream.filter("crop", w=width, h=height, x=x, y=y)

        # Apply fps filter and output
        # NOTE: Frame rate sampling strategy
        # Currently we use fixed-rate sampling (default 10Hz) stored in video_preferences.index_framerate_hz.
        # This provides consistent frame indexing across all videos regardless of native framerate.
        #
        # Native framerate support considerations (NOT YET IMPLEMENTED):
        # - Common video framerates: 23.976fps (film), 29.97fps (NTSC), 25fps (PAL), 50fps, 60fps
        # - These are often fractional (e.g., 24000/1001 ≈ 23.976) to avoid precision errors
        # - FFmpeg's fps filter resamples to target rate, select filter preserves native frames
        # - For native framerate: use select='not(mod(n,N))' where N = round(fps/desired_rate)
        # - Timestamp precision: Use frame PTS (presentation timestamp) for accurate indexing
        # - Database impact: timestamp_seconds would vary per video based on native framerate
        #
        # For now, fixed 10Hz sampling simplifies frame indexing and temporal feature extraction.
        stream = stream.filter("fps", fps=rate_hz)

        (
            stream.output(
                str(output_pattern),
                format="image2",
                **{"q:v": 6},  # JPEG quality (lower is better, 1-31 range)
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode() if e.stderr else ""
        raise RuntimeError(f"FFmpeg failed: {stderr}") from e
    except FileNotFoundError as e:
        raise FileNotFoundError("FFmpeg not found. Please install FFmpeg: https://ffmpeg.org/download.html") from e

    # Collect extracted frame paths
    frame_files = sorted(output_dir.glob("frame_*.jpg"))

    # Report progress if callback provided
    if progress_callback:
        progress_callback(len(frame_files), expected_frames)

    return frame_files


def get_video_dimensions(video_path: Path) -> tuple[int, int]:
    """Get video dimensions (width, height).

    Args:
        video_path: Path to video file

    Returns:
        Tuple of (width, height) in pixels

    Raises:
        RuntimeError: If ffprobe fails or dimensions cannot be determined
    """
    try:
        probe = ffmpeg.probe(str(video_path))
        video_stream = next(
            (stream for stream in probe["streams"] if stream["codec_type"] == "video"),
            None,
        )
        if not video_stream:
            raise RuntimeError("No video stream found")

        width = int(video_stream["width"])
        height = int(video_stream["height"])
        return width, height
    except (ffmpeg.Error, KeyError, ValueError, StopIteration) as e:
        raise RuntimeError(f"Failed to get video dimensions: {e}") from e


def extract_frames_streaming(
    video_path: Path,
    output_dir: Path,
    rate_hz: float = 0.1,
    crop_box: tuple[int, int, int, int] | None = None,
    max_threads: int = 4,
) -> subprocess.Popen:
    """Extract frames from video as streaming background process.

    Launches FFmpeg in background to extract frames at specified rate.
    Frames are written as they're extracted. Caller should poll the
    returned process to monitor progress and check completion.

    Args:
        video_path: Path to input video file
        output_dir: Directory to save extracted frames
        rate_hz: Frame sampling rate in Hz (default: 0.1)
        crop_box: Optional crop region as (x, y, width, height)
        max_threads: Maximum threads for FFmpeg (default: 4 for IDE responsiveness)

    Returns:
        FFmpeg process handle (use .poll() to check status, .wait() to block)

    Raises:
        FileNotFoundError: If FFmpeg is not installed

    Example:
        >>> proc = extract_frames_streaming(video_path, output_dir, rate_hz=0.1)
        >>> while proc.poll() is None:
        ...     # Do other work while frames are being extracted
        ...     time.sleep(0.1)
        >>> if proc.returncode != 0:
        ...     raise RuntimeError("FFmpeg failed")
    """
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build FFmpeg pipeline
    output_pattern = output_dir / "frame_%010d.jpg"
    stream = ffmpeg.input(str(video_path))

    # Apply crop filter if specified
    if crop_box is not None:
        x, y, width, height = crop_box
        stream = stream.filter("crop", w=width, h=height, x=x, y=y)

    # Apply fps filter
    # NOTE: Frame rate sampling strategy
    # Currently we use fixed-rate sampling (default 10Hz) stored in video_preferences.index_framerate_hz.
    # This provides consistent frame indexing across all videos regardless of native framerate.
    #
    # Native framerate support considerations (NOT YET IMPLEMENTED):
    # - Common video framerates: 23.976fps (film), 29.97fps (NTSC), 25fps (PAL), 50fps, 60fps
    # - These are often fractional (e.g., 24000/1001 ≈ 23.976) to avoid precision errors
    # - FFmpeg's fps filter resamples to target rate, select filter preserves native frames
    # - For native framerate: use select='not(mod(n,N))' where N = round(fps/desired_rate)
    # - Timestamp precision: Use frame PTS (presentation timestamp) for accurate indexing
    # - Database impact: timestamp_seconds would vary per video based on native framerate
    #
    # For now, fixed 10Hz sampling simplifies frame indexing and temporal feature extraction.
    stream = stream.filter("fps", fps=rate_hz)

    # Launch FFmpeg in background
    ffmpeg_process = (
        stream.output(
            str(output_pattern),
            format="image2",
            **{
                "q:v": 6,  # JPEG quality (lower is better, 1-31 range)
                "fps_mode": "passthrough",  # Pass through timestamps without sync
                "frame_pts": "1",  # Use frame PTS for numbering
            },
        )
        .global_args("-threads", str(max_threads))  # Limit threads for IDE responsiveness
        .global_args("-fflags", "+genpts")  # Generate presentation timestamps
        .global_args("-flush_packets", "1")  # Flush packets immediately
        .overwrite_output()
        .run_async()
    )

    return ffmpeg_process
