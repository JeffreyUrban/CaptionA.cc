"""Data processing modules for caption boundaries detection."""

from caption_boundaries.data.dataset import CaptionBoundaryDataset
from caption_boundaries.data.ocr_visualization import (
    OCRVisualizationVariant,
    create_ocr_visualization,
    save_visualization,
    visualize_boxes_3d,
    visualize_boxes_both,
    visualize_boxes_boundaries,
    visualize_boxes_centers,
)
from caption_boundaries.data.transforms import (
    AnchorAwareResize,
    NormalizeImageNet,
    ResizeStrategy,
)

__all__ = [
    # Dataset
    "CaptionBoundaryDataset",
    # OCR visualization
    "OCRVisualizationVariant",
    "create_ocr_visualization",
    "save_visualization",
    "visualize_boxes_boundaries",
    "visualize_boxes_centers",
    "visualize_boxes_both",
    "visualize_boxes_3d",
    # Transforms
    "AnchorAwareResize",
    "NormalizeImageNet",
    "ResizeStrategy",
]
