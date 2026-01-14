"""
CaptionA.cc Modal Functions Package

This package contains Modal serverless functions for GPU-intensive video processing.

Three main functions:
1. extract_frames_and_ocr - Frame extraction and OCR (T4 GPU)
2. crop_and_infer_caption_frame_extents - Cropping and inference (A10G GPU)
3. generate_caption_ocr - Median frame OCR (T4 GPU)

All functions are called remotely from Prefect flows running in the API service.
"""

# Export models for use by Prefect flows
from .models import (
    CropRegion,
    ExtractResult,
    CropInferResult,
    CaptionOcrResult,
)

# Export function protocols (interface contracts)
from .functions import (
    ExtractFramesAndOcr,
    CropAndInferCaptionFrameExtents,
    GenerateCaptionOcr,
)

__all__ = [
    # Data models
    "CropRegion",
    "ExtractResult",
    "CropInferResult",
    "CaptionOcrResult",
    # Function protocols (interfaces)
    "ExtractFramesAndOcr",
    "CropAndInferCaptionFrameExtents",
    "GenerateCaptionOcr",
]
