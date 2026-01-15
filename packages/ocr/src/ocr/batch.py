"""Batch size calculation for OCR processing with montage assembly.

This module provides functions to calculate optimal batch sizes for processing
frames through OCR, considering backend constraints and even distribution across batches.
"""

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .backends.base import OCRBackend

# Constants matching gpu_video_utils/montage.py
HEIGHT_LIMIT_PX = 50000
PIXEL_LIMIT = 50000000
FILE_SIZE_LIMIT_MB = 15
MAX_FRAMES_PER_JOB = 950
SEPARATOR_PX = 2


def calculate_max_batch_size(
    frame_width: int,
    frame_height: int,
    backend: "OCRBackend",
) -> int:
    """Calculate maximum frames per batch given frame dimensions and backend constraints.

    This function determines how many frames can fit in a single montage based on:
    - Height limit: 50,000px total montage height
    - Total pixel limit: 50,000,000 pixels total
    - File size limit: 15MB estimated JPEG size
    - Config limit: 950 frames maximum
    - Backend-specific constraints (from backend.get_constraints())

    The most restrictive constraint determines the final batch size.

    Args:
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        backend: OCR backend instance with constraint information

    Returns:
        Maximum number of frames that can fit in a single batch

    Example:
        >>> from ocr.backends.google_vision import GoogleVisionBackend
        >>> backend = GoogleVisionBackend()
        >>> max_batch = calculate_max_batch_size(666, 64, backend)
        >>> print(f"Can fit {max_batch} frames per batch")
        Can fit 757 frames per batch
    """
    # Calculate max by height
    # Formula: (HEIGHT_LIMIT + separator) / (frame_height + separator)
    max_by_height = (HEIGHT_LIMIT_PX + SEPARATOR_PX) // (frame_height + SEPARATOR_PX)

    # Calculate max by total pixels
    max_by_pixels = PIXEL_LIMIT // (frame_width * frame_height)

    # Estimate max by file size (rough estimate based on observed compression)
    # Based on test: 950 frames @ 666×64 = 15.41 MB
    reference_bytes_per_frame = (15.41 * 1024 * 1024) / 950
    reference_pixels_per_frame = 666 * 64
    estimated_bytes_per_frame = reference_bytes_per_frame * (frame_width * frame_height) / reference_pixels_per_frame
    max_by_size = int((FILE_SIZE_LIMIT_MB * 1024 * 1024) / estimated_bytes_per_frame)

    # Apply configured max frames limit
    max_by_config = MAX_FRAMES_PER_JOB

    # Get backend-specific constraints
    backend_constraints = backend.get_constraints()

    # Calculate max based on backend height constraint if present
    max_by_backend_height = float('inf')
    if 'max_image_height' in backend_constraints:
        backend_height_limit = backend_constraints['max_image_height']
        max_by_backend_height = (backend_height_limit + SEPARATOR_PX) // (frame_height + SEPARATOR_PX)

    # Calculate max based on backend file size constraint if present
    max_by_backend_size = float('inf')
    if 'max_file_size_bytes' in backend_constraints:
        backend_size_limit_bytes = backend_constraints['max_file_size_bytes']
        max_by_backend_size = int(backend_size_limit_bytes / estimated_bytes_per_frame)

    # Find minimum (most restrictive) across all constraints
    max_images = min(
        max_by_height,
        max_by_pixels,
        max_by_size,
        max_by_config,
        max_by_backend_height,
        max_by_backend_size,
    )

    return int(max_images)


def calculate_even_batch_size(total_frames: int, max_batch_size: int) -> int:
    """Calculate batch size that distributes frames evenly across batches.

    Given the max batch size, determine the number of batches needed, then
    calculate the batch size that distributes frames most evenly across those batches.

    This ensures that all batches are approximately the same size, avoiding the
    situation where you have mostly full batches and one small final batch.

    Args:
        total_frames: Total number of frames to process
        max_batch_size: Maximum frames per batch (from calculate_max_batch_size)

    Returns:
        Optimal batch size that evenly distributes frames

    Examples:
        >>> calculate_even_batch_size(100, 30)
        25
        # Explanation: 100 frames with max 30 needs ceil(100/30)=4 batches
        # Even distribution: ceil(100/4)=25 frames per batch

        >>> calculate_even_batch_size(50, 100)
        50
        # All frames fit in one batch

        >>> calculate_even_batch_size(1000, 300)
        250
        # 1000 frames with max 300 needs ceil(1000/300)=4 batches
        # Even distribution: ceil(1000/4)=250 frames per batch
    """
    if total_frames <= max_batch_size:
        return total_frames

    # Calculate minimum number of batches needed
    num_batches = math.ceil(total_frames / max_batch_size)

    # Calculate even batch size
    return math.ceil(total_frames / num_batches)
