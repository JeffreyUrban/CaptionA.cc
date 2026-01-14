"""OCR processing library with pluggable backends.

High-level usage:
    from ocr import OCRProcessor, GoogleVisionBackend

    backend = GoogleVisionBackend()
    processor = OCRProcessor(backend)
    results = processor.process_frames(frames, language="zh-Hans")

Or use the functional API:
    from ocr import process_frames_with_ocr, GoogleVisionBackend

    backend = GoogleVisionBackend()
    results = process_frames_with_ocr(frames, backend, language="zh-Hans")
"""

from .backends import OCRBackend
from .batch import calculate_even_batch_size, calculate_max_batch_size

# Optional backend imports - these may not be available in all environments
try:
    from .backends.google_vision import GoogleVisionBackend
except ImportError:
    GoogleVisionBackend = None  # type: ignore

try:
    from .backends.livetext import LiveTextBackend
except ImportError:
    LiveTextBackend = None  # type: ignore
from .database import (
    ensure_ocr_table,
    load_ocr_for_frame,
    load_ocr_for_frame_range,
    write_ocr_result_to_database,
)
from .models import BoundingBox, CharacterResult, OCRResult
from .montage import create_vertical_montage, distribute_results_to_images
from .processing import process_frames_with_ocr

__all__ = [
    # Models
    "OCRResult",
    "BoundingBox",
    "CharacterResult",
    # Backends
    "OCRBackend",
    "GoogleVisionBackend",
    "LiveTextBackend",
    # Processing
    "process_frames_with_ocr",
    "calculate_max_batch_size",
    "calculate_even_batch_size",
    # Montage
    "create_vertical_montage",
    "distribute_results_to_images",
    # Database
    "ensure_ocr_table",
    "write_ocr_result_to_database",
    "load_ocr_for_frame",
    "load_ocr_for_frame_range",
]
