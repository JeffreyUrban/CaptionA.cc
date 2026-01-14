"""GPU-accelerated frame extraction at configurable rates."""

from io import BytesIO
from pathlib import Path
from typing import Callable, List, Optional, Tuple, Union

import torch
from PIL import Image as PILImage

from .decoder import GPUVideoDecoder


def extract_frames_gpu(
    video_path: Path,
    frame_rate_hz: float,
    output_format: str = "pil",
    crop_region: Optional[Tuple[int, int, int, int]] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> List[Union[torch.Tensor, PILImage.Image, bytes]]:
    """Extract frames using GPU decoder at specified rate.

    Args:
        video_path: Path to video file
        frame_rate_hz: Frames per second to extract (e.g., 0.1 for 1 frame per 10s)
        output_format: Output format - "tensor" (GPU), "pil" (CPU PIL Images), "jpeg_bytes" (CPU JPEG bytes)
        crop_region: Optional crop region as (left, top, right, bottom) in pixels
        progress_callback: Optional callback(current, total) for progress tracking

    Returns:
        List of frames in requested format

    Examples:
        # Extract 1 frame per 10 seconds as PIL Images
        frames = extract_frames_gpu("video.mp4", 0.1, output_format="pil")

        # Extract 10 frames per second as JPEG bytes
        frames = extract_frames_gpu("video.mp4", 10.0, output_format="jpeg_bytes")
    """
    if output_format not in ["tensor", "pil", "jpeg_bytes"]:
        raise ValueError(f"Invalid output_format: {output_format}. Must be one of: tensor, pil, jpeg_bytes")

    decoder = GPUVideoDecoder(video_path)
    video_info = decoder.get_video_info()

    total_frames = video_info["total_frames"]
    native_fps = video_info["fps"]
    video_duration = video_info["duration"]

    # Calculate number of output frames
    num_output_frames = int(video_duration * frame_rate_hz)

    print(f"Extracting {num_output_frames} frames at {frame_rate_hz} Hz from {video_duration:.1f}s video")

    frames = []

    for frame_idx in range(num_output_frames):
        # Calculate timestamp for this output frame
        target_time = frame_idx / frame_rate_hz

        # Extract frame on GPU
        frame_tensor = decoder.get_frame_at_time(target_time)

        # Apply GPU cropping if requested
        if crop_region is not None:
            left, top, right, bottom = crop_region
            frame_tensor = frame_tensor[top:bottom, left:right, :]

        # Convert to requested format
        if output_format == "tensor":
            # Keep on GPU
            frames.append(frame_tensor)
        elif output_format == "pil":
            # Transfer to CPU and convert to PIL
            frame_np = frame_tensor.cpu().numpy()
            pil_image = PILImage.fromarray(frame_np)
            frames.append(pil_image)
        elif output_format == "jpeg_bytes":
            # Transfer to CPU, convert to PIL, encode to JPEG bytes
            frame_np = frame_tensor.cpu().numpy()
            pil_image = PILImage.fromarray(frame_np)
            buffer = BytesIO()
            pil_image.save(buffer, format="JPEG", quality=95)
            frames.append(buffer.getvalue())

        # Progress callback
        if progress_callback is not None:
            progress_callback(frame_idx + 1, num_output_frames)

        # Periodic logging (every 100 frames or at the end)
        if (frame_idx + 1) % 100 == 0 or (frame_idx + 1) == num_output_frames:
            print(f"Extracted {frame_idx + 1}/{num_output_frames} frames ({((frame_idx + 1) / num_output_frames * 100):.1f}%)")

    decoder.close()
    return frames


def extract_frames_for_montage(
    video_path: Path,
    frame_rate_hz: float,
    max_frames_per_batch: int,
    crop_region: Optional[Tuple[int, int, int, int]] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> List[Tuple[List[int], List[bytes]]]:
    """Extract frames in batches sized for montage assembly.

    Each batch contains frame indices and JPEG bytes ready for montage creation.

    Args:
        video_path: Path to video file
        frame_rate_hz: Frames per second to extract
        max_frames_per_batch: Maximum frames per montage batch
        crop_region: Optional crop region as (left, top, right, bottom) in pixels
        progress_callback: Optional callback(current, total) for progress tracking

    Returns:
        List of batches, where each batch is (frame_indices, jpeg_bytes)
        - frame_indices: List of frame indices in this batch
        - jpeg_bytes: List of JPEG-encoded frame bytes

    Example:
        batches = extract_frames_for_montage("video.mp4", 0.1, max_frames_per_batch=200)
        for frame_indices, jpeg_frames in batches:
            # Process batch (e.g., assemble montage, send to OCR service)
            print(f"Batch: {len(frame_indices)} frames, indices {frame_indices[0]}-{frame_indices[-1]}")
    """
    # Extract all frames as JPEG bytes
    all_frames = extract_frames_gpu(
        video_path=video_path,
        frame_rate_hz=frame_rate_hz,
        output_format="jpeg_bytes",
        crop_region=crop_region,
        progress_callback=progress_callback,
    )

    # Split into batches
    batches = []
    for i in range(0, len(all_frames), max_frames_per_batch):
        batch_frames = all_frames[i:i + max_frames_per_batch]
        # Frame indices use convention: frame_index = time_in_seconds * 10
        # This matches the existing full_frames convention
        batch_indices = [int((j / frame_rate_hz) * 10) for j in range(i, i + len(batch_frames))]
        batches.append((batch_indices, batch_frames))

    return batches
