"""Streaming frame extraction and processing.

This module provides streaming functions that process frames as they're extracted,
minimizing disk usage by deleting intermediate frames after processing.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal, Optional

from caption_models import load_analysis_text
from image_utils import resize_image
from video_utils import extract_frames_streaming, get_video_dimensions, get_video_duration


def stream_extract_and_resize(
    video_path: Path,
    analysis_path: Path,
    cropped_dir: Path,
    resized_dir: Path,
    rate_hz: float = 10.0,
    target_width: int = 480,
    target_height: int = 48,
    preserve_aspect: bool = False,
    keep_cropped: bool = True,
    progress_callback: Optional[callable] = None,
    max_workers: int = 4,
) -> int:
    """Extract frames with cropping and resize in streaming fashion.

    Runs FFmpeg in background to extract cropped frames, then processes each frame
    as it becomes available. By default keeps both cropped and resized frames.

    Args:
        video_path: Path to input video file
        analysis_path: Path to subtitle_analysis.txt file
        cropped_dir: Directory for intermediate cropped frames
        resized_dir: Directory for final resized frames
        rate_hz: Frame sampling rate in Hz (default: 10.0)
        target_width: Target width for resized frames
        target_height: Target height for resized frames
        preserve_aspect: If True, maintain aspect ratio with padding
        keep_cropped: If True, keep cropped frames (default: True, keep both)
        progress_callback: Optional callback (current, total) -> None
        max_workers: Maximum concurrent resize workers (default: 4)

    Returns:
        Number of frames processed

    Raises:
        FileNotFoundError: If video or analysis file not found
        RuntimeError: If FFmpeg fails
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not analysis_path.exists():
        raise FileNotFoundError(f"Analysis file not found: {analysis_path}")

    # Load subtitle region analysis
    region = load_analysis_text(analysis_path)

    # Get video dimensions and duration
    width, height = get_video_dimensions(video_path)
    duration = get_video_duration(video_path)
    expected_frames = int(duration * rate_hz)

    # Convert fractional crop bounds to pixel coordinates
    x = int(region.crop_left * width)
    y = int(region.crop_top * height)
    crop_width = int((region.crop_right - region.crop_left) * width)
    crop_height = int((region.crop_bottom - region.crop_top) * height)

    # Create directories for cropped and resized frames
    cropped_dir.mkdir(parents=True, exist_ok=True)
    resized_dir.mkdir(parents=True, exist_ok=True)

    # Prepare crop box
    crop_box = (x, y, crop_width, crop_height)

    # Start FFmpeg extraction with cropping in background using shared utility
    ffmpeg_process = extract_frames_streaming(
        video_path=video_path,
        output_dir=cropped_dir,
        rate_hz=rate_hz,
        crop_box=crop_box,
    )

    submitted_frames = set()  # Frames submitted to workers
    current_count = 0

    # Process frames as they appear
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}  # future -> frame_path mapping
        ffmpeg_done = False

        while True:
            # Check for new frames
            frame_files = sorted(cropped_dir.glob("frame_*.jpg"))
            new_frames = [frame for frame in frame_files if frame not in submitted_frames]

            # Submit new frames to worker pool
            for frame_path in new_frames:
                # Wait to ensure file is fully written
                time.sleep(0.05)

                # Submit resize task
                output_path = resized_dir / frame_path.name
                future = executor.submit(
                    resize_image,
                    frame_path,
                    output_path,
                    target_size=(target_width, target_height),
                    preserve_aspect=preserve_aspect,
                )
                futures[future] = frame_path
                submitted_frames.add(frame_path)

            # Collect completed results (non-blocking)
            for future in list(futures.keys()):
                if future.done():
                    frame_path = futures.pop(future)
                    try:
                        future.result()  # Raises exception if resize failed

                        # Delete intermediate cropped frame unless keeping
                        if not keep_cropped:
                            frame_path.unlink()

                        # Update progress
                        current_count += 1
                        if progress_callback:
                            progress_callback(current_count, expected_frames)

                    except Exception as e:
                        print(f"ERROR processing {frame_path.name}: {e}")

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
        raise RuntimeError(f"FFmpeg failed with return code {ffmpeg_process.returncode}")

    # Clean up cropped directory if not keeping cropped frames
    if not keep_cropped and cropped_dir.exists():
        import shutil
        shutil.rmtree(cropped_dir)

    return current_count


def stream_extract_frames(
    video_path: Path,
    analysis_path: Path,
    output_dir: Path,
    rate_hz: float = 10.0,
    processing_mode: Literal["save", "delete"] = "save",
    progress_callback: Optional[callable] = None,
) -> int:
    """Extract frames with cropping in streaming fashion.

    Runs FFmpeg in background to extract cropped frames. In "delete" mode,
    frames are immediately deleted after extraction (useful for testing
    or when another process will consume them). In "save" mode (default),
    frames are kept.

    Args:
        video_path: Path to input video file
        analysis_path: Path to subtitle_analysis.txt file
        output_dir: Directory for extracted frames
        rate_hz: Frame sampling rate in Hz (default: 10.0)
        processing_mode: "save" to keep frames, "delete" for immediate deletion
        progress_callback: Optional callback (current, total) -> None

    Returns:
        Number of frames extracted

    Raises:
        FileNotFoundError: If video or analysis file not found
        RuntimeError: If FFmpeg fails
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if not analysis_path.exists():
        raise FileNotFoundError(f"Analysis file not found: {analysis_path}")

    # Load subtitle region analysis
    region = load_analysis_text(analysis_path)

    # Get video dimensions and duration
    width, height = get_video_dimensions(video_path)
    duration = get_video_duration(video_path)
    expected_frames = int(duration * rate_hz)

    # Convert fractional crop bounds to pixel coordinates
    x = int(region.crop_left * width)
    y = int(region.crop_top * height)
    crop_width = int((region.crop_right - region.crop_left) * width)
    crop_height = int((region.crop_bottom - region.crop_top) * height)
    crop_box = (x, y, crop_width, crop_height)

    # Start FFmpeg extraction with cropping in background using shared utility
    ffmpeg_process = extract_frames_streaming(
        video_path=video_path,
        output_dir=output_dir,
        rate_hz=rate_hz,
        crop_box=crop_box,
    )

    seen_frames = set()  # Frames we've already seen
    current_count = 0

    # Monitor frames as they appear
    ffmpeg_done = False
    while True:
        # Check for new frames
        frame_files = sorted(output_dir.glob("frame_*.jpg"))
        new_frames = [frame for frame in frame_files if frame not in seen_frames]

        # Process new frames
        for frame_path in new_frames:
            seen_frames.add(frame_path)
            current_count += 1

            # Delete immediately in delete mode
            if processing_mode == "delete":
                time.sleep(0.05)  # Ensure file is fully written
                frame_path.unlink()

            # Update progress
            if progress_callback:
                progress_callback(current_count, expected_frames)

        # Check if FFmpeg has completed
        if not ffmpeg_done:
            poll_result = ffmpeg_process.poll()
            if poll_result is not None:
                ffmpeg_done = True

        # Exit when FFmpeg is done
        if ffmpeg_done:
            # One final check for any remaining frames
            frame_files = sorted(output_dir.glob("frame_*.jpg"))
            final_new_frames = [frame for frame in frame_files if frame not in seen_frames]
            for frame_path in final_new_frames:
                seen_frames.add(frame_path)
                current_count += 1
                if processing_mode == "delete":
                    frame_path.unlink()
                if progress_callback:
                    progress_callback(current_count, expected_frames)
            break

        # Small sleep to avoid busy-waiting
        time.sleep(0.1)

    # Check for FFmpeg errors
    if ffmpeg_process.returncode != 0:
        raise RuntimeError(f"FFmpeg failed with return code {ffmpeg_process.returncode}")

    return current_count
