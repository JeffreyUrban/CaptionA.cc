"""Shared OCR processing utilities using OCR service or macOS LiveText fallback."""

from ocr_utils.database import (
    ensure_ocr_table,
    load_ocr_for_frame,
    load_ocr_for_frame_range,
    write_ocr_result_to_database,
)
from ocr_utils.ocr_service_client import OCRServiceAdapter, OCRServiceError
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
    "OCRServiceAdapter",
    "OCRServiceError",
    "process_frame_ocr_with_retry",
    "process_frames_directory",
    "process_frames_streaming",
    "create_ocr_visualization",
    "ensure_ocr_table",
    "write_ocr_result_to_database",
    "load_ocr_for_frame",
    "load_ocr_for_frame_range",
]
