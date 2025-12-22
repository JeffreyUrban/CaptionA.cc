"""Subtitle region analysis from OCR bounding boxes."""

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mode, stdev
from typing import Optional

import cv2
import numpy as np
from PIL import Image


@dataclass
class SubtitleRegion:
    """Analyzed subtitle region characteristics."""

    vertical_position: float  # Mode of vertical center position (pixels)
    vertical_std: float  # Standard deviation of vertical position
    box_height: float  # Mode of box heights (pixels)
    height_std: float  # Standard deviation of box heights
    anchor_type: str  # "left", "center", or "right"
    anchor_position: float  # Mode of anchor position (pixels)
    crop_left: int  # Recommended crop coordinates (pixels)
    crop_top: int
    crop_right: int
    crop_bottom: int
    total_boxes: int  # Number of boxes analyzed


def load_ocr_annotations(ocr_file: Path) -> list[dict]:
    """Load OCR annotations from JSONL file.

    Args:
        ocr_file: Path to OCR.jsonl file

    Returns:
        List of OCR result dictionaries
    """
    annotations = []
    with ocr_file.open("r") as f:
        for line in f:
            if line.strip():
                annotations.append(json.loads(line))
    return annotations


def convert_fractional_bounds_to_pixels(frac_bounds, img_width, img_height):
    """Convert fractional bounds [x, y, w, h] to pixel bounds [left, top, right, bottom].
    Note: Input y is measured from bottom, but output is measured from top."""
    x, y, w, h = frac_bounds
    left = int(x * img_width)
    # Convert y from bottom-referenced to top-referenced
    bottom = int((1 - y) * img_height)  # First convert y to measure from top
    top = bottom - int(h * img_height)  # Then subtract height to get top coordinate
    right = int((x + w) * img_width)
    return [left, top, right, bottom]


def box_overlap_fraction(box1, box2):
    """Calculate what fraction of box1 overlaps with box2."""
    # box format: [left, top, right, bottom]
    x_left = max(box1[0], box2[0])
    y_top = max(box1[1], box2[1])
    x_right = min(box1[2], box2[2])
    y_bottom = min(box1[3], box2[3])

    if x_right < x_left or y_bottom < y_top:
        return 0.0

    intersection_area = (x_right - x_left) * (y_bottom - y_top)
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])

    return intersection_area / (box1_area + 1e-6)


def determine_anchor_type(boxes, episode_bounds):
    """Determine if boxes are left, center, or right anchored.

    Uses mode (most common position) and counts boxes at that position.
    The edge with the most boxes clustered at its mode is the anchor.
    """
    if not boxes:
        return "center"

    # Extract edge positions
    left_edges = [box[0] for box in boxes]
    right_edges = [box[2] for box in boxes]
    centers = [(box[0] + box[2]) / 2 for box in boxes]

    # Find mode (most common position) for each edge type
    from statistics import mode
    try:
        left_mode = mode(left_edges)
        right_mode = mode(right_edges)
        center_mode = mode([int(c) for c in centers])  # Round centers for mode
    except:
        # If mode fails (no unique mode), fall back to median
        left_mode = sorted(left_edges)[len(left_edges) // 2]
        right_mode = sorted(right_edges)[len(right_edges) // 2]
        center_mode = sorted(centers)[len(centers) // 2]

    # Count boxes at or near each mode (within tolerance)
    tolerance = 5  # pixels
    left_count = sum(1 for x in left_edges if abs(x - left_mode) <= tolerance)
    right_count = sum(1 for x in right_edges if abs(x - right_mode) <= tolerance)
    center_count = sum(1 for c in centers if abs(c - center_mode) <= tolerance)

    # The edge with the most boxes at its mode is the anchor
    max_count = max(left_count, right_count, center_count)
    if max_count == left_count:
        return "left"
    elif max_count == right_count:
        return "right"
    else:
        return "center"


def get_anchor_position(boxes, anchor_type, episode_bounds):
    """Get the mode position of the anchor point based on anchor type."""
    if not boxes:
        return None

    positions = []
    for box in boxes:
        if anchor_type == "left":
            positions.append(box[0])  # Left edge
        elif anchor_type == "right":
            positions.append(box[2])  # Right edge
        else:  # center
            positions.append((box[0] + box[2]) // 2)  # Center point

    # Round positions to nearest pixel to help find mode
    positions = [round(p) for p in positions]
    try:
        return mode(positions)
    except:
        # If no unique mode, return median
        return sorted(positions)[len(positions) // 2]


def analyze_subtitle_region(
    ocr_annotations: list[dict],
    reference_image: Path,
    min_overlap: float = 0.75,
) -> SubtitleRegion:
    """Analyze OCR boxes to determine subtitle region characteristics.

    Args:
        ocr_annotations: List of OCR result dictionaries
        reference_image: Path to reference frame for dimensions
        min_overlap: Minimum overlap fraction to consider a box (0-1)

    Returns:
        SubtitleRegion with analyzed characteristics
    """
    if not ocr_annotations:
        raise ValueError("No OCR annotations provided")

    # Get image dimensions from reference frame
    img = cv2.imread(str(reference_image))
    if img is None:
        raise ValueError(f"Failed to load image at {reference_image}")

    img_height, img_width = img.shape[:2]

    # Default initial region: bottom third of frame
    # In pixel coordinates: [left, top, right, bottom]
    episode_bounds = [0, int(img_height * 0.67), img_width, img_height]

    # Process OCR annotations and filter by overlap
    valid_boxes = []
    total_boxes = 0

    for entry in ocr_annotations:
        total_boxes += len(entry["annotations"])
        for text, confidence, frac_bounds in entry["annotations"]:
            # Convert fractional bounds to pixels
            box = convert_fractional_bounds_to_pixels(frac_bounds, img_width, img_height)
            overlap = box_overlap_fraction(box, episode_bounds)

            if overlap >= min_overlap:
                valid_boxes.append(box)

    if not valid_boxes:
        raise ValueError(f"No valid boxes found (total boxes: {total_boxes})")

    # Step 1: Calculate mode of top and bottom boundaries
    top_edges = [box[1] for box in valid_boxes]
    bottom_edges = [box[3] for box in valid_boxes]
    top_mode = mode(top_edges)
    bottom_mode = mode(bottom_edges)

    # Step 2: Filter boxes with top/bottom approximately equal to modes (typical subtitle boxes)
    tolerance = 5  # pixels
    typical_boxes = [
        box for box in valid_boxes
        if abs(box[1] - top_mode) <= tolerance and abs(box[3] - bottom_mode) <= tolerance
    ]

    if not typical_boxes:
        # Fallback to all valid boxes if filtering is too strict
        typical_boxes = valid_boxes

    # Step 3: Find left/right bounds from typical boxes using mode
    margin = 10  # pixels
    left_edges = [box[0] for box in typical_boxes]
    right_edges = [box[2] for box in typical_boxes]

    # Use mode for the anchor edge, max for the variable edge
    # Since typical_boxes are already filtered to consistent height/position,
    # we can safely use max to capture all caption lengths
    left_mode = mode(left_edges)
    right_max = max(right_edges)

    crop_left = max(0, left_mode - margin)
    crop_right = min(img_width, right_max + margin)
    crop_top = max(0, top_mode - margin)
    crop_bottom = min(img_height, bottom_mode + margin)

    # Step 4: Determine anchor by which side is most populated and consistent
    anchor_type = determine_anchor_type(typical_boxes, episode_bounds)
    anchor_position = get_anchor_position(typical_boxes, anchor_type, episode_bounds)

    # Calculate statistics for reporting
    heights = [box[3] - box[1] for box in typical_boxes]
    vertical_positions = [(box[1] + box[3]) // 2 for box in typical_boxes]

    return SubtitleRegion(
        vertical_position=mode(vertical_positions),
        vertical_std=stdev(vertical_positions),
        box_height=mode(heights),
        height_std=stdev(heights),
        anchor_type=anchor_type,
        anchor_position=anchor_position,
        crop_left=crop_left,
        crop_top=crop_top,
        crop_right=crop_right,
        crop_bottom=crop_bottom,
        total_boxes=len(valid_boxes),
    )


def save_analysis_text(region: SubtitleRegion, output_file: Path) -> None:
    """Save subtitle region analysis as text file.

    Args:
        region: Analyzed subtitle region
        output_file: Path to output text file
    """
    stats_dict = {
        "num_valid_boxes": region.total_boxes,
        "height_mode": region.box_height,
        "height_std": float(f"{region.height_std:.2f}"),
        "vertical_position_mode": region.vertical_position,
        "vertical_position_std": float(f"{region.vertical_std:.2f}"),
        "anchor_type": region.anchor_type,
        "anchor_position": region.anchor_position,
        "crop_bounds": [
            region.crop_left,
            region.crop_top,
            region.crop_right,
            region.crop_bottom,
        ],
    }

    human_readable_stats = f"""Subtitle Box Analysis
Number of valid boxes: {stats_dict['num_valid_boxes']}
Height mode: {stats_dict['height_mode']} pixels
Height standard deviation: {stats_dict['height_std']} pixels
Vertical position mode: {stats_dict['vertical_position_mode']} pixels
Vertical position standard deviation: {stats_dict['vertical_position_std']} pixels
Anchor type: {stats_dict['anchor_type']}
Anchor position: {stats_dict['anchor_position']} pixels
Crop bounds: {stats_dict['crop_bounds']}
"""

    with output_file.open("w") as f:
        f.write(human_readable_stats)
        f.write("\n---\n")
        f.write(json.dumps(stats_dict))
        f.write("\n")


def create_analysis_visualization(
    region: SubtitleRegion,
    ocr_annotations: list[dict],
    output_image: Path,
    reference_image: Path,
) -> None:
    """Create visualization of subtitle region analysis.

    Creates visualization with OCR boxes overlaid with analysis lines.

    Args:
        region: Analyzed subtitle region
        ocr_annotations: OCR annotations for drawing boxes
        output_image: Path to save visualization
        reference_image: Path to reference frame image
    """
    # Load the OCR.png visualization
    ocr_img_path = output_image.parent / "OCR.png"
    if not ocr_img_path.exists():
        raise ValueError(f"OCR.png not found at {ocr_img_path}")

    img = cv2.imread(str(ocr_img_path))
    if img is None:
        raise ValueError(f"Failed to load image at {ocr_img_path}")

    img_height, img_width = img.shape[:2]

    # Draw crop bounds (green) - tight box around detected captions
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
            cv2.line(
                img,
                (region.anchor_position, region.crop_top),
                (region.anchor_position, region.crop_bottom),
                (255, 0, 0),
                2,
            )
        elif region.anchor_type == "right":
            cv2.line(
                img,
                (region.anchor_position, region.crop_top),
                (region.anchor_position, region.crop_bottom),
                (0, 0, 255),
                2,
            )
        else:  # center
            cv2.line(
                img,
                (region.anchor_position, region.crop_top),
                (region.anchor_position, region.crop_bottom),
                (255, 255, 0),
                2,
            )

    # Draw vertical position mode line (cyan)
    cv2.line(
        img,
        (region.crop_left, region.vertical_position),
        (region.crop_right, region.vertical_position),
        (0, 255, 255),
        2,
    )

    # Add anchor type label
    cv2.putText(
        img, f"Anchor: {region.anchor_type}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2
    )

    # Save visualization
    cv2.imwrite(str(output_image), img)
