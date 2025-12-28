"""Core logic for caption frame extraction and processing.

This module provides functions for extracting and resizing video frames with cropping.
All functions work with generic video paths and crop coordinates.
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from image_utils import resize_directory, resize_image
from PIL import Image
from video_utils import extract_frames_streaming, get_video_duration


def extract_frames(
    video_path: Path,
    output_dir: Path,
    crop_box: tuple[int, int, int, int],
    rate_hz: float = 10.0,
    resize_to: tuple[int, int] | None = None,
    preserve_aspect: bool = False,
    progress_callback: callable | None = None,
) -> tuple[Path, int]:
    """Extract frames from video with cropping and optional resizing.

    Args:
        video_path: Path to input video file
        output_dir: Directory for output frames
        crop_box: Crop region as (x, y, width, height) in pixels
        rate_hz: Frame sampling rate in Hz (default: 10.0)
        resize_to: Optional (width, height) to resize frames after extraction
        preserve_aspect: If True and resizing, maintain aspect ratio with padding
        progress_callback: Optional callback function (current, total) -> None

    Returns:
        Tuple of (output_dir, num_frames)

    Raises:
        FileNotFoundError: If video file not found
        RuntimeError: If FFmpeg fails
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    # If not resizing, extract directly to output_dir
    if resize_to is None:
        output_dir.mkdir(parents=True, exist_ok=True)

        # Start FFmpeg extraction with cropping
        ffmpeg_process = extract_frames_streaming(
            video_path=video_path,
            output_dir=output_dir,
            rate_hz=rate_hz,
            crop_box=crop_box,
        )

        # Monitor progress
        duration = get_video_duration(video_path)
        expected_frames = int(duration * rate_hz)
        seen_frames = set()
        ffmpeg_done = False

        while True:
            # Check for new frames
            frame_files = sorted(output_dir.glob("frame_*.jpg"))
            new_frames = [frame for frame in frame_files if frame not in seen_frames]

            # Update progress for new frames
            for frame_path in new_frames:
                seen_frames.add(frame_path)
                if progress_callback:
                    progress_callback(len(seen_frames), expected_frames)

            # Check if FFmpeg has completed
            if not ffmpeg_done:
                poll_result = ffmpeg_process.poll()
                if poll_result is not None:
                    ffmpeg_done = True

            # Exit when FFmpeg is done
            if ffmpeg_done:
                # Final check for any remaining frames
                frame_files = sorted(output_dir.glob("frame_*.jpg"))
                final_frames = [frame for frame in frame_files if frame not in seen_frames]
                for frame_path in final_frames:
                    seen_frames.add(frame_path)
                    if progress_callback:
                        progress_callback(len(seen_frames), expected_frames)
                break

            time.sleep(0.1)

        # Check for FFmpeg errors
        if ffmpeg_process.returncode != 0:
            raise RuntimeError(f"FFmpeg failed with return code {ffmpeg_process.returncode}")

        return output_dir, len(seen_frames)

    # If resizing, extract to temp directory then resize in streaming fashion
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        cropped_dir = output_dir / "cropped"
        resized_dir = output_dir / "resized"
        cropped_dir.mkdir(parents=True, exist_ok=True)
        resized_dir.mkdir(parents=True, exist_ok=True)

        # Start FFmpeg extraction with cropping
        ffmpeg_process = extract_frames_streaming(
            video_path=video_path,
            output_dir=cropped_dir,
            rate_hz=rate_hz,
            crop_box=crop_box,
        )

        # Get expected frame count
        duration = get_video_duration(video_path)
        expected_frames = int(duration * rate_hz)

        # Process frames as they appear
        submitted_frames = set()
        current_count = 0

        with ThreadPoolExecutor(max_workers=os.cpu_count()) as executor:
            futures = {}
            ffmpeg_done = False

            while True:
                # Check for new frames
                frame_files = sorted(cropped_dir.glob("frame_*.jpg"))
                new_frames = [frame for frame in frame_files if frame not in submitted_frames]

                # Submit new frames to worker pool
                for frame_path in new_frames:
                    time.sleep(0.05)  # Ensure file is fully written
                    output_path = resized_dir / frame_path.name
                    future = executor.submit(
                        resize_image,
                        frame_path,
                        output_path,
                        target_size=resize_to,
                        resample=Image.Resampling.LANCZOS,
                        preserve_aspect=preserve_aspect,
                    )
                    futures[future] = frame_path
                    submitted_frames.add(frame_path)

                # Collect completed results
                for future in list(futures.keys()):
                    if future.done():
                        frame_path = futures.pop(future)
                        try:
                            future.result()
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

                time.sleep(0.1)

        # Check for FFmpeg errors
        if ffmpeg_process.returncode != 0:
            raise RuntimeError(f"FFmpeg failed with return code {ffmpeg_process.returncode}")

        return resized_dir, current_count


def resize_frames(
    input_dir: Path,
    output_dir: Path,
    target_width: int,
    target_height: int,
    preserve_aspect: bool = False,
    progress_callback: callable | None = None,
) -> tuple[Path, int]:
    """Resize all frames in a directory to fixed dimensions.

    Args:
        input_dir: Directory containing input frames
        output_dir: Directory for output frames
        target_width: Target width in pixels
        target_height: Target height in pixels
        preserve_aspect: If True, maintain aspect ratio with padding (default: False, stretch)
        progress_callback: Optional callback function (current, total) -> None

    Returns:
        Tuple of (output_dir, num_frames)

    Raises:
        FileNotFoundError: If input directory not found
    """
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
