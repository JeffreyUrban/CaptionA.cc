"""OCR box visualization for caption boundaries detection.

Creates spatial prior visualizations from OCR box data, matching Layout Annotation style.

Four experimental variants:
- boundaries: Draw actual OCR box rectangles (edges, not filled)
- centers: Mark center points of character boxes
- both: Overlay boundaries + centers for maximum information
- 3d_channels: RGB channel encoding (R=boundaries, G=centers, B=confidence)

Character detection is about borders, not interiors, so we preserve actual
box boundaries rather than using Gaussian density maps.
"""

from enum import Enum
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from PIL import Image


class OCRVisualizationVariant(str, Enum):
    """OCR visualization variant types."""

    BOUNDARIES = "boundaries"
    CENTERS = "centers"
    BOTH = "both"
    THREE_D_CHANNELS = "3d_channels"


def visualize_boxes_boundaries(
    image_size: tuple[int, int],
    boxes: list[dict],
    thickness: int = 1,
    normalize_confidence: bool = True,
) -> np.ndarray:
    """Visualize OCR boxes as boundary rectangles (Variant A).

    Draws actual OCR box edges (not filled) to preserve spatial information
    about character positions. Intensity represents confidence.

    Args:
        image_size: (width, height) of output image
        boxes: List of OCR boxes with keys: x, y, width, height, confidence
        thickness: Line thickness for rectangles (default 1)
        normalize_confidence: Scale confidence to full 0-255 range

    Returns:
        Grayscale image (H, W) with box boundaries, uint8

    Example:
        >>> boxes = [
        ...     {"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.95},
        ...     {"x": 50, "y": 20, "width": 25, "height": 15, "confidence": 0.88},
        ... ]
        >>> viz = visualize_boxes_boundaries((640, 480), boxes)
        >>> viz.shape
        (480, 640)
    """
    width, height = image_size
    image = np.zeros((height, width), dtype=np.uint8)

    if not boxes:
        return image

    # Get confidence range for normalization
    if normalize_confidence and boxes:
        confidences = [box.get("confidence", 1.0) for box in boxes]
        min_conf = min(confidences)
        max_conf = max(confidences)
        conf_range = max_conf - min_conf if max_conf > min_conf else 1.0
    else:
        min_conf = 0.0
        conf_range = 1.0

    for box in boxes:
        x = int(box["x"])
        y = int(box["y"])
        w = int(box["width"])
        h = int(box["height"])
        confidence = box.get("confidence", 1.0)

        # Scale confidence to 0-255
        if normalize_confidence:
            intensity = int(((confidence - min_conf) / conf_range) * 255)
        else:
            intensity = int(confidence * 255)

        # Draw rectangle
        cv2.rectangle(image, (x, y), (x + w, y + h), intensity, thickness)

    return image


def visualize_boxes_centers(
    image_size: tuple[int, int],
    boxes: list[dict],
    radius: int = 2,
    normalize_confidence: bool = True,
) -> np.ndarray:
    """Visualize OCR boxes as center points (Variant B).

    Marks the center of each character box with a circle. Useful for
    density visualization without boundary overlap.

    Args:
        image_size: (width, height) of output image
        boxes: List of OCR boxes with keys: x, y, width, height, confidence
        radius: Circle radius for center markers (default 2)
        normalize_confidence: Scale confidence to full 0-255 range

    Returns:
        Grayscale image (H, W) with box centers, uint8

    Example:
        >>> boxes = [{"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.95}]
        >>> viz = visualize_boxes_centers((640, 480), boxes)
    """
    width, height = image_size
    image = np.zeros((height, width), dtype=np.uint8)

    if not boxes:
        return image

    # Get confidence range for normalization
    if normalize_confidence and boxes:
        confidences = [box.get("confidence", 1.0) for box in boxes]
        min_conf = min(confidences)
        max_conf = max(confidences)
        conf_range = max_conf - min_conf if max_conf > min_conf else 1.0
    else:
        min_conf = 0.0
        conf_range = 1.0

    for box in boxes:
        x = int(box["x"])
        y = int(box["y"])
        w = int(box["width"])
        h = int(box["height"])
        confidence = box.get("confidence", 1.0)

        # Calculate center
        center_x = x + w // 2
        center_y = y + h // 2

        # Scale confidence to 0-255
        if normalize_confidence:
            intensity = int(((confidence - min_conf) / conf_range) * 255)
        else:
            intensity = int(confidence * 255)

        # Draw circle at center
        cv2.circle(image, (center_x, center_y), radius, (intensity, intensity, intensity), -1)

    return image


def visualize_boxes_both(
    image_size: tuple[int, int],
    boxes: list[dict],
    boundary_thickness: int = 1,
    center_radius: int = 2,
    normalize_confidence: bool = True,
) -> np.ndarray:
    """Visualize OCR boxes with both boundaries and centers (Variant C).

    Overlays boundary rectangles and center points for maximum spatial
    information. Uses max() to combine, so brighter areas have both.

    Args:
        image_size: (width, height) of output image
        boxes: List of OCR boxes with keys: x, y, width, height, confidence
        boundary_thickness: Line thickness for rectangles (default 1)
        center_radius: Circle radius for center markers (default 2)
        normalize_confidence: Scale confidence to full 0-255 range

    Returns:
        Grayscale image (H, W) with both boundaries and centers, uint8

    Example:
        >>> boxes = [{"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.95}]
        >>> viz = visualize_boxes_both((640, 480), boxes)
    """
    # Create both visualizations
    boundaries = visualize_boxes_boundaries(image_size, boxes, boundary_thickness, normalize_confidence)
    centers = visualize_boxes_centers(image_size, boxes, center_radius, normalize_confidence)

    # Combine with max (brightest wins)
    combined = np.maximum(boundaries, centers)

    return combined


def visualize_boxes_3d(
    image_size: tuple[int, int],
    boxes: list[dict],
    boundary_thickness: int = 1,
    center_radius: int = 2,
    normalize_confidence: bool = True,
) -> np.ndarray:
    """Visualize OCR boxes with 3D channel encoding (Variant D).

    Uses RGB channels for different information:
    - R channel: Box boundaries
    - G channel: Box centers
    - B channel: Confidence heatmap (distance from centers)

    Args:
        image_size: (width, height) of output image
        boxes: List of OCR boxes with keys: x, y, width, height, confidence
        boundary_thickness: Line thickness for rectangles (default 1)
        center_radius: Circle radius for center markers (default 2)
        normalize_confidence: Scale confidence to full 0-255 range

    Returns:
        RGB image (H, W, 3) with channel-encoded information, uint8

    Example:
        >>> boxes = [{"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.95}]
        >>> viz = visualize_boxes_3d((640, 480), boxes)
        >>> viz.shape
        (480, 640, 3)
    """
    width, height = image_size

    # R channel: Boundaries
    r_channel = visualize_boxes_boundaries(image_size, boxes, boundary_thickness, normalize_confidence)

    # G channel: Centers
    g_channel = visualize_boxes_centers(image_size, boxes, center_radius, normalize_confidence)

    # B channel: Confidence heatmap (decay from centers)
    b_channel = np.zeros((height, width), dtype=np.uint8)

    if boxes:
        # Create distance transform from centers
        centers_mask = visualize_boxes_centers(image_size, boxes, radius=1, normalize_confidence=False)
        if centers_mask.max() > 0:
            # Distance transform (pixels get darker further from centers)
            dist_transform = cv2.distanceTransform(255 - centers_mask, cv2.DIST_L2, 5)
            # Normalize and invert (closer = brighter)
            if dist_transform.max() > 0:
                normalized = dist_transform / dist_transform.max()
                b_channel = (255 * (1 - normalized)).astype(np.uint8)

    # Stack into RGB
    rgb = np.stack([r_channel, g_channel, b_channel], axis=2)

    return rgb


def create_ocr_visualization(
    image_size: tuple[int, int],
    boxes: list[dict],
    variant: OCRVisualizationVariant | Literal["boundaries", "centers", "both", "3d_channels"] = "boundaries",
    **kwargs,
) -> np.ndarray:
    """Create OCR box visualization with specified variant.

    Factory function to create any visualization variant. This is the main
    entry point for creating visualizations.

    Args:
        image_size: (width, height) of output image
        boxes: List of OCR boxes with keys: x, y, width, height, confidence
        variant: Visualization variant to use
        **kwargs: Additional arguments passed to variant function
            - thickness: Line thickness for boundaries (default 1)
            - radius: Circle radius for centers (default 2)
            - normalize_confidence: Scale confidence range (default True)

    Returns:
        Visualization image as numpy array (grayscale or RGB)

    Example:
        >>> boxes = [{"x": 10, "y": 20, "width": 30, "height": 15, "confidence": 0.95}]
        >>> # Boundaries only
        >>> viz = create_ocr_visualization((640, 480), boxes, "boundaries")
        >>> # 3D encoding
        >>> viz_3d = create_ocr_visualization((640, 480), boxes, "3d_channels")
    """
    variant_str = variant.value if isinstance(variant, OCRVisualizationVariant) else variant

    if variant_str == "boundaries":
        return visualize_boxes_boundaries(image_size, boxes, **kwargs)
    elif variant_str == "centers":
        return visualize_boxes_centers(image_size, boxes, **kwargs)
    elif variant_str == "both":
        return visualize_boxes_both(image_size, boxes, **kwargs)
    elif variant_str == "3d_channels":
        return visualize_boxes_3d(image_size, boxes, **kwargs)
    else:
        raise ValueError(f"Unknown variant: {variant_str}")


def save_visualization(image: np.ndarray, output_path: Path) -> None:
    """Save visualization to file.

    Args:
        image: Visualization image (grayscale or RGB)
        output_path: Path to save PNG file

    Example:
        >>> viz = create_ocr_visualization((640, 480), boxes, "boundaries")
        >>> save_visualization(viz, Path("ocr_viz.png"))
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Convert to PIL and save
    if len(image.shape) == 2:
        # Grayscale
        pil_image = Image.fromarray(image, mode="L")
    else:
        # RGB
        pil_image = Image.fromarray(image, mode="RGB")

    pil_image.save(output_path)
