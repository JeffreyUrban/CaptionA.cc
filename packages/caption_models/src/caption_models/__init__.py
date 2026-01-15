"""Shared data models for caption processing pipelines."""

from caption_models.analysis import analyze_subtitle_region
from caption_models.coordinates import (
    BoundingBox,
    CropBounds,
    box_overlap_with_crop,
    cropped_to_original,
    is_box_inside_crop,
    original_to_cropped,
)
from caption_models.io import load_analysis_text, load_ocr_annotations, save_analysis_text
from caption_models.models import SubtitleRegion
from caption_models.visualization import create_analysis_visualization

try:
    from caption_models._version import __version__, __version_tuple__
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "unknown")

__all__ = [
    "__version__",
    "__version_tuple__",
    "SubtitleRegion",
    "BoundingBox",
    "CropBounds",
    "analyze_subtitle_region",
    "load_ocr_annotations",
    "save_analysis_text",
    "load_analysis_text",
    "create_analysis_visualization",
    "original_to_cropped",
    "cropped_to_original",
    "is_box_inside_crop",
    "box_overlap_with_crop",
]
