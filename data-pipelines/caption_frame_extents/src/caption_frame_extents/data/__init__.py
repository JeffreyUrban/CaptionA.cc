"""Data processing modules for caption frame extents detection."""

from caption_frame_extents.data.dataset import CaptionFrameExtentsDataset
from caption_frame_extents.data.ocr_visualization import (
    OCRVisualizationVariant,
    create_ocr_visualization,
    save_visualization,
    visualize_boxes_3d,
    visualize_boxes_both,
    visualize_boxes_boundaries,
    visualize_boxes_centers,
)
from caption_frame_extents.data.transforms import (
    AnchorAwareResize,
    NormalizeImageNet,
    ResizeStrategy,
)

__all__ = [
    # Dataset
    "CaptionFrameExtentsDataset",
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
