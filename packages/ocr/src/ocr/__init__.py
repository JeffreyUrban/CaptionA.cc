"""OCR processing library with pluggable backends.

High-level usage with automatic backend selection:
    from ocr import get_backend, process_frames_with_ocr

    # Automatically selects backend based on ENVIRONMENT variable:
    # - local: uses LiveTextBackend (macOS ocrmac)
    # - staging/production: uses GoogleVisionBackend
    backend = get_backend()
    results = process_frames_with_ocr(frames, backend, language="zh-Hans")

Or explicitly specify a backend:
    from ocr import get_backend, process_frames_with_ocr

    backend = get_backend("google_vision")  # or "livetext"
    results = process_frames_with_ocr(frames, backend, language="zh-Hans")

Environment variables:
    OCR_BACKEND: Override backend selection ('livetext' or 'google_vision')
    ENVIRONMENT: Used if OCR_BACKEND not set (local -> livetext, else google_vision)
"""

import os

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


def get_backend(backend_name: str | None = None) -> OCRBackend:
    """Get an OCR backend instance based on environment or explicit name.

    Backend selection priority:
    1. Explicit backend_name parameter
    2. OCR_BACKEND environment variable
    3. ENVIRONMENT variable (local -> livetext, else -> google_vision)

    Args:
        backend_name: Optional explicit backend name ('livetext' or 'google_vision')

    Returns:
        Instantiated OCRBackend

    Raises:
        ValueError: If requested backend is not available
        RuntimeError: If no suitable backend can be found
    """
    # Determine which backend to use
    if backend_name is None:
        backend_name = os.environ.get("OCR_BACKEND")

    if backend_name is None:
        environment = os.environ.get("ENVIRONMENT", "").lower()
        backend_name = "livetext" if environment == "local" else "google_vision"

    backend_name = backend_name.lower()

    if backend_name == "livetext":
        if LiveTextBackend is None:
            raise ValueError(
                "LiveTextBackend not available. Install ocrmac: pip install ocrmac"
            )
        return LiveTextBackend()
    elif backend_name == "google_vision":
        if GoogleVisionBackend is None:
            raise ValueError(
                "GoogleVisionBackend not available. Install google-cloud-vision: "
                "pip install google-cloud-vision"
            )
        return GoogleVisionBackend()
    else:
        raise ValueError(
            f"Unknown backend: {backend_name}. Available: 'livetext', 'google_vision'"
        )
from .database import (
    ensure_ocr_table,
    load_ocr_for_frame,
    load_ocr_for_frame_range,
    write_ocr_result_to_database,
)
from .models import BoundingBox, CharacterResult, OCRResult
from .montage import create_vertical_montage, distribute_results_to_images
from .processing import process_frames_with_ocr
from .visualization import create_ocr_visualization

__all__ = [
    # Models
    "OCRResult",
    "BoundingBox",
    "CharacterResult",
    # Backends
    "OCRBackend",
    "GoogleVisionBackend",
    "LiveTextBackend",
    "get_backend",
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
    # Visualization
    "create_ocr_visualization",
]
