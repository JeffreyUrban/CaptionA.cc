"""Shared OCR processing utilities using macOS LiveText."""

from ocr_utils.processing import (
    OCRTimeoutError,
    process_frame_ocr_with_retry,
    process_frames_directory,
    process_frames_streaming,
)
from ocr_utils.visualization import create_ocr_visualization

try:
    from ocr_utils._version import __version__, __version_tuple__
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "unknown")

__all__ = [
    "__version__",
    "__version_tuple__",
    "OCRTimeoutError",
    "process_frame_ocr_with_retry",
    "process_frames_directory",
    "process_frames_streaming",
    "create_ocr_visualization",
]
