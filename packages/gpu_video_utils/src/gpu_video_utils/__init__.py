"""GPU-accelerated video processing utilities."""

from .decoder import GPUVideoDecoder
from .frame_extraction import extract_frames_gpu, extract_frames_for_montage
from .gpu_montage import (
    MontageValidationError,
    create_vertical_montage_cpu,
    create_vertical_montage_from_pil,
    create_vertical_montage_gpu,
    tensors_to_montage_gpu,
)
from .montage import calculate_montage_capacity

__all__ = [
    "GPUVideoDecoder",
    "extract_frames_gpu",
    "extract_frames_for_montage",
    "calculate_montage_capacity",
    # GPU montage functions
    "create_vertical_montage_gpu",
    "create_vertical_montage_cpu",
    "create_vertical_montage_from_pil",
    "tensors_to_montage_gpu",
    "MontageValidationError",
]
