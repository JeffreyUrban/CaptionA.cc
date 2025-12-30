"""Subtitle region analysis from OCR bounding boxes.

This module re-exports analysis functions from the shared caption_models package.
"""

from caption_models import (
    SubtitleRegion,
    create_analysis_visualization,
    load_ocr_annotations,
    save_analysis_text,
)

__all__ = [
    "SubtitleRegion",
    "load_ocr_annotations",
    "save_analysis_text",
    "create_analysis_visualization",
]
