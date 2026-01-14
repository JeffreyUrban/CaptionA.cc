"""GPU-accelerated montage assembly using PyTorch/CUDA.

This module provides GPU-accelerated vertical montage creation, matching
the logic from services/ocr-service/app.py (lines 312-368).

Key features:
- GPU-accelerated montage assembly for maximum throughput
- CPU fallback for environments without CUDA
- Same output format as the OCR service montage function
"""

from io import BytesIO
from typing import Dict, List, Tuple

import torch
from PIL import Image

# Default separator pixels between images (matching OCR service)
SEPARATOR_PX = 2

# Separator color (light gray)
SEPARATOR_COLOR = (220, 220, 220)


class MontageValidationError(Exception):
    """Raised when montage validation fails (e.g., dimension mismatch)."""

    pass


def create_vertical_montage_gpu(
    frames: List[torch.Tensor],
    frame_ids: List[str],
    separator_px: int = SEPARATOR_PX,
    device: str = "cuda",
    jpeg_quality: int = 95,
) -> Tuple[bytes, List[Dict]]:
    """Create vertical montage from GPU tensors.

    Stacks images vertically with separator pixels between them, performing
    all operations on GPU for maximum throughput before final CPU transfer.

    Args:
        frames: List of GPU tensors (H, W, C) in uint8 RGB format.
                All frames must have identical dimensions.
        frame_ids: List of frame identifiers (same length as frames)
        separator_px: Pixels between images (default: 2)
        device: GPU device string (default: "cuda")
        jpeg_quality: JPEG encoding quality 1-100 (default: 95)

    Returns:
        Tuple of (montage_jpeg_bytes, metadata_list):
        - montage_jpeg_bytes: JPEG-encoded montage image
        - metadata_list: Position info for each frame:
          [{"id": str, "x": 0, "y": int, "width": int, "height": int}, ...]

    Raises:
        ValueError: If frames list is empty or frame_ids length doesn't match
        MontageValidationError: If frame dimensions don't match

    Example:
        >>> frames = [tensor1, tensor2, tensor3]  # Each (64, 666, 3) on GPU
        >>> ids = ["frame_0", "frame_10", "frame_20"]
        >>> jpeg_bytes, metadata = create_vertical_montage_gpu(frames, ids)
        >>> print(f"Montage size: {len(jpeg_bytes)} bytes")
        >>> print(f"Frame 1 position: y={metadata[1]['y']}")
    """
    if not frames:
        raise ValueError("No frames provided")

    if len(frames) != len(frame_ids):
        raise ValueError(
            f"frames ({len(frames)}) and frame_ids ({len(frame_ids)}) must have same length"
        )

    # Get dimensions from first frame
    first_frame = frames[0]
    if first_frame.dim() != 3:
        raise MontageValidationError(
            f"Expected 3D tensor (H, W, C), got {first_frame.dim()}D tensor"
        )

    height, width, channels = first_frame.shape

    if channels != 3:
        raise MontageValidationError(
            f"Expected 3 channels (RGB), got {channels} channels"
        )

    # Validate all frames have same dimensions
    for i, frame in enumerate(frames):
        if frame.shape != first_frame.shape:
            raise MontageValidationError(
                f"Frame {frame_ids[i]} dimensions {tuple(frame.shape)} don't match "
                f"expected {tuple(first_frame.shape)}"
            )

    # Calculate total montage height
    # total_height = n * frame_height + (n - 1) * separator_px
    num_frames = len(frames)
    total_height = num_frames * height + (num_frames - 1) * separator_px

    # Create montage tensor on GPU, filled with separator color
    montage = torch.empty(
        (total_height, width, 3), dtype=torch.uint8, device=device
    )
    # Fill with separator color (220, 220, 220)
    montage[:, :, 0] = SEPARATOR_COLOR[0]
    montage[:, :, 1] = SEPARATOR_COLOR[1]
    montage[:, :, 2] = SEPARATOR_COLOR[2]

    # Build metadata and paste frames
    metadata: List[Dict] = []
    y_offset = 0

    for i, (frame, frame_id) in enumerate(zip(frames, frame_ids)):
        # Ensure frame is on correct device
        if frame.device.type != device.split(":")[0]:
            frame = frame.to(device)

        # Paste frame at current y_offset
        montage[y_offset : y_offset + height, :, :] = frame

        # Record metadata
        metadata.append(
            {
                "id": frame_id,
                "x": 0,
                "y": y_offset,
                "width": width,
                "height": height,
            }
        )

        # Advance y_offset (frame height + separator)
        y_offset += height + separator_px

    # Transfer to CPU and convert to numpy
    montage_cpu = montage.cpu().numpy()

    # Convert to PIL Image
    montage_pil = Image.fromarray(montage_cpu)

    # Encode to JPEG bytes
    buffer = BytesIO()
    montage_pil.save(buffer, format="JPEG", quality=jpeg_quality)

    return buffer.getvalue(), metadata


def create_vertical_montage_cpu(
    images: List[Tuple[str, bytes]],
    separator_px: int = SEPARATOR_PX,
    jpeg_quality: int = 95,
) -> Tuple[bytes, List[Dict]]:
    """Create vertical montage from PIL Images (CPU fallback).

    This function matches the logic from services/ocr-service/app.py:create_vertical_montage()
    and provides a CPU-based fallback for environments without GPU support.

    Args:
        images: List of (id, image_bytes) tuples where image_bytes is JPEG/PNG encoded
        separator_px: Pixels between images (default: 2)
        jpeg_quality: JPEG encoding quality 1-100 (default: 95)

    Returns:
        Tuple of (montage_jpeg_bytes, metadata_list):
        - montage_jpeg_bytes: JPEG-encoded montage image
        - metadata_list: Position info for each image:
          [{"id": str, "x": 0, "y": int, "width": int, "height": int}, ...]

    Raises:
        ValueError: If images list is empty or dimensions don't match

    Example:
        >>> images = [("frame_0", jpeg_bytes1), ("frame_10", jpeg_bytes2)]
        >>> montage_bytes, metadata = create_vertical_montage_cpu(images)
    """
    if not images:
        raise ValueError("No images provided")

    # Load first image to get dimensions
    first_img = Image.open(BytesIO(images[0][1]))
    width = first_img.width
    height = first_img.height

    # Calculate total height
    total_height = len(images) * height + (len(images) - 1) * separator_px

    # Create montage canvas filled with separator color
    montage = Image.new("RGB", (width, total_height), SEPARATOR_COLOR)

    metadata: List[Dict] = []
    y_offset = 0

    for img_id, img_data in images:
        img = Image.open(BytesIO(img_data))

        # Verify dimensions match
        if img.width != width or img.height != height:
            raise ValueError(
                f"Image {img_id} dimensions {img.width}x{img.height} "
                f"don't match expected {width}x{height}"
            )

        # Paste image at current offset
        montage.paste(img, (0, y_offset))

        # Store metadata
        metadata.append(
            {
                "id": img_id,
                "x": 0,
                "y": y_offset,
                "width": width,
                "height": height,
            }
        )

        y_offset += height + separator_px

    # Encode to JPEG bytes
    buffer = BytesIO()
    montage.save(buffer, format="JPEG", quality=jpeg_quality)

    return buffer.getvalue(), metadata


def create_vertical_montage_from_pil(
    images: List[Image.Image],
    frame_ids: List[str],
    separator_px: int = SEPARATOR_PX,
    jpeg_quality: int = 95,
) -> Tuple[bytes, List[Dict]]:
    """Create vertical montage from PIL Image objects directly.

    Convenience function for when you already have PIL Images in memory
    (e.g., from GPU tensor conversion or image processing pipelines).

    Args:
        images: List of PIL Image objects (all must have same dimensions)
        frame_ids: List of frame identifiers (same length as images)
        separator_px: Pixels between images (default: 2)
        jpeg_quality: JPEG encoding quality 1-100 (default: 95)

    Returns:
        Tuple of (montage_jpeg_bytes, metadata_list)

    Raises:
        ValueError: If images list is empty, frame_ids length mismatch, or dimensions differ
    """
    if not images:
        raise ValueError("No images provided")

    if len(images) != len(frame_ids):
        raise ValueError(
            f"images ({len(images)}) and frame_ids ({len(frame_ids)}) must have same length"
        )

    # Get dimensions from first image
    width = images[0].width
    height = images[0].height

    # Calculate total height
    total_height = len(images) * height + (len(images) - 1) * separator_px

    # Create montage canvas
    montage = Image.new("RGB", (width, total_height), SEPARATOR_COLOR)

    metadata: List[Dict] = []
    y_offset = 0

    for img, frame_id in zip(images, frame_ids):
        # Verify dimensions
        if img.width != width or img.height != height:
            raise ValueError(
                f"Image {frame_id} dimensions {img.width}x{img.height} "
                f"don't match expected {width}x{height}"
            )

        # Paste image
        montage.paste(img, (0, y_offset))

        # Store metadata
        metadata.append(
            {
                "id": frame_id,
                "x": 0,
                "y": y_offset,
                "width": width,
                "height": height,
            }
        )

        y_offset += height + separator_px

    # Encode to JPEG
    buffer = BytesIO()
    montage.save(buffer, format="JPEG", quality=jpeg_quality)

    return buffer.getvalue(), metadata


def tensors_to_montage_gpu(
    frames: List[torch.Tensor],
    frame_ids: List[str],
    separator_px: int = SEPARATOR_PX,
    device: str = "cuda",
    jpeg_quality: int = 95,
    fallback_to_cpu: bool = True,
) -> Tuple[bytes, List[Dict]]:
    """Create montage with automatic GPU/CPU selection.

    Attempts GPU-accelerated montage assembly, falling back to CPU
    if CUDA is unavailable or if an error occurs.

    Args:
        frames: List of tensors (H, W, C) in uint8 RGB format
        frame_ids: List of frame identifiers
        separator_px: Pixels between images (default: 2)
        device: Preferred GPU device (default: "cuda")
        jpeg_quality: JPEG encoding quality (default: 95)
        fallback_to_cpu: If True, fall back to CPU on GPU failure (default: True)

    Returns:
        Tuple of (montage_jpeg_bytes, metadata_list)

    Raises:
        RuntimeError: If GPU fails and fallback_to_cpu is False
    """
    # Check if CUDA is available
    use_gpu = torch.cuda.is_available() and device.startswith("cuda")

    if use_gpu:
        try:
            return create_vertical_montage_gpu(
                frames=frames,
                frame_ids=frame_ids,
                separator_px=separator_px,
                device=device,
                jpeg_quality=jpeg_quality,
            )
        except Exception as e:
            if not fallback_to_cpu:
                raise RuntimeError(f"GPU montage failed: {e}") from e
            print(f"GPU montage failed, falling back to CPU: {e}")

    # CPU fallback: convert tensors to PIL images
    pil_images = []
    for frame in frames:
        # Ensure on CPU
        if frame.device.type != "cpu":
            frame = frame.cpu()
        pil_images.append(Image.fromarray(frame.numpy()))

    return create_vertical_montage_from_pil(
        images=pil_images,
        frame_ids=frame_ids,
        separator_px=separator_px,
        jpeg_quality=jpeg_quality,
    )
