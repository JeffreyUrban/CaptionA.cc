"""Subtitle region analysis from OCR bounding boxes."""

from collections import Counter
from statistics import mode, stdev

from caption_models.models import SubtitleRegion


def convert_fractional_bounds_to_pixels(frac_bounds, img_width, img_height):
    """Convert fractional bounds [x, y, w, h] to pixel bounds [left, top, right, bottom].

    Note: Input y is measured from bottom, but output is measured from top.
    """
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


def determine_anchor_type(boxes, region_bounds):
    """Determine if boxes are left, center, or right anchored based on location.

    Checks which edge has consistency on its respective side:
    - Left-aligned: consistent left edges on the left side of region
    - Right-aligned: consistent right edges on the right side of region
    - Center-aligned: consistent centers in the middle
    """
    if not boxes:
        return "center"

    # Extract edge positions
    left_edges = [box[0] for box in boxes]
    right_edges = [box[2] for box in boxes]

    # Get bounds
    min_left = min(left_edges)
    max_right = max(right_edges)
    region_width = max_right - min_left

    # For left-aligned: filter to boxes on left side, check left edge consistency
    left_threshold = min_left + region_width * 0.2  # Left 20% of region
    left_side_boxes = [box for box in boxes if box[0] <= left_threshold]
    left_side_edges = [box[0] for box in left_side_boxes]
    left_consistency = stdev(left_side_edges) if len(left_side_edges) > 1 else float("inf")

    # For right-aligned: filter to boxes on right side, check right edge consistency
    right_threshold = max_right - region_width * 0.2  # Right 20% of region
    right_side_boxes = [box for box in boxes if box[2] >= right_threshold]
    right_side_edges = [box[2] for box in right_side_boxes]
    right_consistency = (
        stdev(right_side_edges) if len(right_side_edges) > 1 else float("inf")
    )

    # For center-aligned: check consistency of ALL box centers
    center_positions = [(box[0] + box[2]) / 2 for box in boxes]
    center_consistency = (
        stdev(center_positions) if len(center_positions) > 1 else float("inf")
    )

    # Penalize left/right with too few boxes (likely just noise, not actual anchor)
    min_boxes = len(boxes) * 0.1  # At least 10% of boxes on anchor side
    if len(left_side_boxes) < min_boxes:
        left_consistency = float("inf")
    if len(right_side_boxes) < min_boxes:
        right_consistency = float("inf")

    # The side with the lowest std (most consistent) is the anchor
    min_consistency = min(left_consistency, right_consistency, center_consistency)
    if min_consistency == left_consistency:
        return "left"
    elif min_consistency == right_consistency:
        return "right"
    else:
        return "center"


def get_anchor_position(boxes, anchor_type, crop_left, crop_right):
    """Get the mode position of the anchor edge from boxes on that end.

    Args:
        boxes: List of bounding boxes [left, top, right, bottom]
        anchor_type: "left", "right", or "center"
        crop_left: Left edge of subtitle region
        crop_right: Right edge of subtitle region

    Returns:
        Mode position of the anchor edge
    """
    if not boxes:
        return None

    # Filter to boxes on the anchor end and extract their positions
    threshold = 50  # pixels from the edge to consider "on that end"

    if anchor_type == "left":
        # Get boxes whose left edge is near the left end
        edge_boxes = [box for box in boxes if box[0] <= crop_left + threshold]
        positions = [box[0] for box in edge_boxes]
    elif anchor_type == "right":
        # Get boxes whose right edge is near the right end
        edge_boxes = [box for box in boxes if box[2] >= crop_right - threshold]
        positions = [box[2] for box in edge_boxes]
    else:  # center
        # For center-aligned, use ALL boxes and find median of centers
        positions = [(box[0] + box[2]) // 2 for box in boxes]

    if not positions:
        return None

    if anchor_type == "center":
        # For center-aligned text, use iterative weighted average
        # Start with simple mean as initial estimate
        center = sum(positions) / len(positions)

        # Iteratively refine: weight boxes by inverse distance from center
        scale = 20  # pixels - typical character width
        for _ in range(3):  # A few iterations is enough
            weights = [1.0 / (1.0 + abs(pos - center) / scale) for pos in positions]
            total_weight = sum(weights)
            center = sum(pos * w for pos, w in zip(positions, weights)) / total_weight

        return int(round(center))
    else:
        # For left/right-aligned, use mode with binning
        bin_size = 5
        binned = [round(p / bin_size) * bin_size for p in positions]
        counter = Counter(binned)
        mode_value = counter.most_common(1)[0][0]
        return mode_value


def analyze_subtitle_region(
    ocr_annotations: list[dict],
    width: int,
    height: int,
    min_overlap: float = 0.75,
) -> SubtitleRegion:
    """Analyze OCR boxes to determine subtitle region characteristics.

    Args:
        ocr_annotations: List of OCR result dictionaries from load_ocr_annotations()
        width: Video frame width in pixels
        height: Video frame height in pixels
        min_overlap: Minimum overlap fraction to consider a box (0-1)

    Returns:
        SubtitleRegion with analyzed characteristics
    """
    if not ocr_annotations:
        raise ValueError("No OCR annotations provided")

    img_width = width
    img_height = height

    # Default initial region: bottom third of frame
    region_bounds = [0, int(img_height * 0.67), img_width, img_height]

    # Process OCR annotations and filter by overlap
    valid_boxes = []
    total_boxes = 0

    for entry in ocr_annotations:
        total_boxes += len(entry["annotations"])
        for text, confidence, frac_bounds in entry["annotations"]:
            # Convert fractional bounds to pixels
            box = convert_fractional_bounds_to_pixels(frac_bounds, img_width, img_height)
            overlap = box_overlap_fraction(box, region_bounds)

            if overlap >= min_overlap:
                valid_boxes.append(box)

    if not valid_boxes:
        raise ValueError(f"No valid boxes found (total boxes: {total_boxes})")

    # Calculate mode of top and bottom boundaries
    top_edges = [box[1] for box in valid_boxes]
    bottom_edges = [box[3] for box in valid_boxes]
    top_mode = mode(top_edges)
    bottom_mode = mode(bottom_edges)

    # Filter boxes with top/bottom approximately equal to modes
    tolerance = 5  # pixels
    typical_boxes = [
        box
        for box in valid_boxes
        if abs(box[1] - top_mode) <= tolerance and abs(box[3] - bottom_mode) <= tolerance
    ]

    if not typical_boxes:
        typical_boxes = valid_boxes

    # Find left/right bounds from typical boxes
    margin = 10  # pixels
    left_edges = [box[0] for box in typical_boxes]
    right_edges = [box[2] for box in typical_boxes]

    left_mode = mode(left_edges)
    right_max = max(right_edges)

    crop_left = max(0, left_mode - margin)
    crop_right = min(img_width, right_max + margin)
    crop_top = max(0, top_mode - margin)
    crop_bottom = min(img_height, bottom_mode + margin)

    # Determine anchor type and position
    anchor_type = determine_anchor_type(typical_boxes, region_bounds)
    anchor_position = get_anchor_position(typical_boxes, anchor_type, crop_left, crop_right)

    # Adjust crop bounds for center-aligned text
    if anchor_type == "center":
        left_dist = anchor_position - crop_left
        right_dist = crop_right - anchor_position
        max_dist = max(left_dist, right_dist)
        crop_left = max(0, anchor_position - max_dist)
        crop_right = min(img_width, anchor_position + max_dist)

    # Calculate statistics
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
