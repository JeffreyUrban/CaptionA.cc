"""Montage capacity calculation matching OCR service logic."""

from typing import Dict, Tuple

# Constants matching services/ocr-service/config.py
HEIGHT_LIMIT_PX = 50000
PIXEL_LIMIT = 50000000
FILE_SIZE_LIMIT_MB = 15
MAX_FRAMES_PER_JOB = 950
SEPARATOR_PX = 2


def calculate_montage_capacity(width: int, height: int) -> Tuple[int, Dict[str, int], str, float]:
    """Calculate maximum number of images that can be safely processed in a montage.

    This function matches the logic from services/ocr-service/app.py:calculate_capacity()
    to ensure consistency across the system.

    Considers ALL constraints:
    - Height limit: 50,000px total montage height
    - Total pixel limit: 50,000,000 pixels total
    - File size limit: 15MB estimated JPEG size
    - Config limit: 950 frames maximum

    Args:
        width: Frame width in pixels
        height: Frame height in pixels

    Returns:
        Tuple of (max_images, limits_dict, limiting_factor, estimated_file_size_mb):
        - max_images: Maximum frames that can fit (min of all constraints)
        - limits_dict: Dict showing limit from each constraint
        - limiting_factor: Which constraint is most restrictive
        - estimated_file_size_mb: Estimated final montage file size

    Example:
        >>> max_frames, limits, factor, size_mb = calculate_montage_capacity(666, 64)
        >>> print(f"Can fit {max_frames} frames (limited by: {factor})")
        Can fit 757 frames (limited by: height)
    """
    # Calculate max by height
    # Formula: (HEIGHT_LIMIT + separator) / (frame_height + separator)
    max_by_height = (HEIGHT_LIMIT_PX + SEPARATOR_PX) // (height + SEPARATOR_PX)

    # Calculate max by total pixels
    max_by_pixels = PIXEL_LIMIT // (width * height)

    # Estimate max by file size (rough estimate based on observed compression)
    # Based on test: 950 frames @ 666×64 = 15.41 MB
    reference_bytes_per_frame = (15.41 * 1024 * 1024) / 950
    reference_pixels_per_frame = 666 * 64
    estimated_bytes_per_frame = reference_bytes_per_frame * (width * height) / reference_pixels_per_frame
    max_by_size = int((FILE_SIZE_LIMIT_MB * 1024 * 1024) / estimated_bytes_per_frame)

    # Apply configured max frames limit
    max_by_config = MAX_FRAMES_PER_JOB

    limits = {
        "by_height": max_by_height,
        "by_pixels": max_by_pixels,
        "by_file_size": max_by_size,
        "by_config": max_by_config,
    }

    # Find minimum (most restrictive)
    max_images = min(max_by_height, max_by_pixels, max_by_size, max_by_config)

    # Determine limiting factor
    if max_images == max_by_config:
        limiting_factor = "config_limit"
    elif max_images == max_by_height:
        limiting_factor = "height"
    elif max_images == max_by_pixels:
        limiting_factor = "total_pixels"
    else:
        limiting_factor = "file_size"

    # Estimate final file size
    estimated_file_size_mb = (estimated_bytes_per_frame * max_images) / (1024 * 1024)

    return max_images, limits, limiting_factor, estimated_file_size_mb
