"""GPU-accelerated frame extraction using PyNvVideoCodec.

This module provides a drop-in replacement for the CPU-based frame extraction
in frames.py, using GPU acceleration via the gpu_video_utils package.
"""

from collections.abc import Callable
from pathlib import Path

from gpu_video_utils import GPUVideoDecoder
from PIL import Image as PILImage


def extract_frames_gpu(
    video_path: Path,
    output_dir: Path,
    rate_hz: float = 0.1,
    crop_box: tuple[int, int, int, int] | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[Path]:
    """Extract frames from video at specified rate using GPU acceleration.

    Drop-in replacement for video_utils.extract_frames() with GPU acceleration.
    Maintains same API and output format for compatibility.

    Args:
        video_path: Path to input video file
        output_dir: Directory to save extracted frames
        rate_hz: Frame sampling rate in Hz (frames per second). Default: 0.1 (1 frame per 10 seconds)
        crop_box: Optional crop region as (x, y, width, height) in pixels. Cropping is done on GPU.
        progress_callback: Optional callback function (current_frame, total_frames) -> None

    Returns:
        List of paths to extracted frame files (frame_NNNNNNNNNN.jpg)

    Note:
        Frame naming convention: frame_index = time_in_seconds * 10
        Example: frame_0000000100.jpg = frame at 10 seconds
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize GPU decoder
    decoder = GPUVideoDecoder(video_path)
    video_info = decoder.get_video_info()

    video_duration = video_info["duration"]
    num_output_frames = int(video_duration * rate_hz)

    # Convert crop_box format if provided
    # video_utils uses (x, y, width, height)
    # gpu_video_utils uses (left, top, right, bottom)
    crop_region = None
    if crop_box is not None:
        x, y, width, height = crop_box
        crop_region = (x, y, x + width, y + height)  # (left, top, right, bottom)

    frame_paths = []

    for frame_idx in range(num_output_frames):
        # Calculate timestamp for this output frame
        target_time = frame_idx / rate_hz

        # Extract frame on GPU
        frame_tensor = decoder.get_frame_at_time(target_time)

        # Apply GPU cropping if requested
        if crop_region is not None:
            left, top, right, bottom = crop_region
            frame_tensor = frame_tensor[top:bottom, left:right, :]

        # Transfer to CPU and convert to PIL
        frame_np = frame_tensor.cpu().numpy()
        pil_image = PILImage.fromarray(frame_np)

        # Calculate frame index using convention: frame_index = time_in_seconds * 10
        # This matches the existing full_frames convention
        frame_index = int(target_time * 10)
        frame_filename = f"frame_{frame_index:010d}.jpg"
        frame_path = output_dir / frame_filename

        # Save as JPEG
        pil_image.save(frame_path, format="JPEG", quality=95)
        frame_paths.append(frame_path)

        # Progress callback
        if progress_callback is not None:
            progress_callback(frame_idx + 1, num_output_frames)

    decoder.close()
    return frame_paths
