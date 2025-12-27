"""Data processing modules for caption boundaries detection."""

from caption_boundaries.data.font_embeddings import (
    FontCLIPModel,
    batch_extract_embeddings,
    extract_font_embedding,
    get_or_create_font_embedding,
)
from caption_boundaries.data.ocr_visualization import (
    OCRVisualizationVariant,
    create_ocr_visualization,
    save_visualization,
    visualize_boxes_3d,
    visualize_boxes_both,
    visualize_boxes_boundaries,
    visualize_boxes_centers,
)
from caption_boundaries.data.reference_selection import (
    ReferenceFrameCandidate,
    get_all_frame_candidates,
    get_reference_frame_stats,
    select_reference_frame,
    select_reference_frame_simple,
)

__all__ = [
    # Font embeddings
    "FontCLIPModel",
    "extract_font_embedding",
    "get_or_create_font_embedding",
    "batch_extract_embeddings",
    # OCR visualization
    "OCRVisualizationVariant",
    "create_ocr_visualization",
    "save_visualization",
    "visualize_boxes_boundaries",
    "visualize_boxes_centers",
    "visualize_boxes_both",
    "visualize_boxes_3d",
    # Reference frame selection
    "ReferenceFrameCandidate",
    "select_reference_frame",
    "select_reference_frame_simple",
    "get_reference_frame_stats",
    "get_all_frame_candidates",
]
