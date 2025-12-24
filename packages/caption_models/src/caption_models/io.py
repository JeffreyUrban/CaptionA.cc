"""I/O functions for loading and saving subtitle region data."""

import json
from pathlib import Path

from caption_models.models import SubtitleRegion


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


def save_analysis_text(region: SubtitleRegion, output_file: Path) -> None:
    """Save subtitle region analysis as text file.

    Saves both human-readable text and JSON representation.

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


def load_analysis_text(input_file: Path) -> dict:
    """Load subtitle region analysis from text file.

    Args:
        input_file: Path to analysis text file

    Returns:
        Dictionary with analysis statistics
    """
    with input_file.open("r") as f:
        content = f.read()

    # Extract JSON from after the separator
    json_start = content.find("---\n") + 4
    if json_start < 4:
        raise ValueError(f"Invalid analysis file format: {input_file}")

    json_content = content[json_start:].strip()
    return json.loads(json_content)
