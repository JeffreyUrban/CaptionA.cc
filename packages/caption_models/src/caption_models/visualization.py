"""Visualization functions for subtitle region analysis."""

from pathlib import Path

import cv2

from caption_models.models import SubtitleRegion


def create_analysis_visualization(
    region: SubtitleRegion,
    _ocr_annotations: list[dict],
    output_image: Path,
) -> None:
    """Create visualization of subtitle region analysis.

    Creates visualization with OCR boxes overlaid with analysis lines.

    Args:
        region: Analyzed subtitle region
        _ocr_annotations: OCR annotations for drawing boxes (unused - uses pre-rendered OCR.png)
        output_image: Path to save visualization
    """
    # Load the OCR.png visualization
    ocr_img_path = output_image.parent / "OCR.png"
    if not ocr_img_path.exists():
        raise ValueError(f"OCR.png not found at {ocr_img_path}")

    img = cv2.imread(str(ocr_img_path))
    if img is None:
        raise ValueError(f"Failed to load image at {ocr_img_path}")

    # Draw crop region (green) - tight box around detected captions
    cv2.rectangle(
        img,
        (region.crop_left, region.crop_top),
        (region.crop_right, region.crop_bottom),
        (0, 255, 0),
        2,
    )

    # Draw horizontal anchor line
    if region.anchor_position is not None:
        if region.anchor_type == "left":
            color = (255, 0, 0)  # Blue for left
        elif region.anchor_type == "right":
            color = (0, 0, 255)  # Red for right
        else:  # center
            color = (255, 255, 0)  # Cyan for center

        cv2.line(
            img,
            (int(region.anchor_position), int(region.crop_top)),
            (int(region.anchor_position), int(region.crop_bottom)),
            color,
            2,
        )

    # Draw vertical position mode line (cyan)
    cv2.line(
        img,
        (int(region.crop_left), int(region.vertical_position)),
        (int(region.crop_right), int(region.vertical_position)),
        (0, 255, 255),
        2,
    )

    # Add anchor type label
    cv2.putText(
        img,
        f"Anchor: {region.anchor_type}",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (255, 255, 255),
        2,
    )

    # Save visualization
    cv2.imwrite(str(output_image), img)
