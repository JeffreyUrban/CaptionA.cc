"""OCR vs VLM text comparison for auto-validation.

Compares VLM-generated caption text with OCR text. When they match exactly,
the caption is auto-validated as correct.
"""

from pathlib import Path
from typing import Any

from .database import (
    get_caption_by_frames,
    get_database_path,
    get_ocr_for_caption_range,
    mark_text_as_validated,
)


def extract_ocr_text_from_annotations(ocr_annotations: list[list[Any]]) -> str:
    """Extract plain text from OCR annotations.

    Args:
        ocr_annotations: List of [[char, confidence, [x1, y1, x2, y2]], ...]

    Returns:
        Concatenated OCR text
    """
    return "".join([ann[0] for ann in ocr_annotations])


def compare_vlm_with_ocr(
    video_dir: Path,
    vlm_results: dict[tuple[int, int], str],
    auto_validate: bool = True,
    write_mismatches: bool = True,
) -> dict[str, Any]:
    """Compare VLM results with OCR text and auto-validate matches.

    Args:
        video_dir: Path to video directory (e.g., local/data/video_id/)
        vlm_results: Dictionary mapping (start_frame, end_frame) -> vlm_text
        auto_validate: If True, mark matching captions as validated
        write_mismatches: If True, write mismatches to CSV file

    Returns:
        Dictionary with statistics:
            - total: Total captions processed
            - matches: Number of exact matches
            - mismatches: Number of mismatches
            - missing_ocr: Number of captions without OCR data
    """
    db_path = get_database_path(video_dir)

    stats = {
        "total": 0,
        "matches": 0,
        "mismatches": 0,
        "missing_ocr": 0,
    }

    mismatches = []

    for (start_frame, end_frame), vlm_text in vlm_results.items():
        stats["total"] += 1

        # Get caption from database
        caption = get_caption_by_frames(db_path, start_frame, end_frame)
        if not caption:
            print(f"Warning: Caption not found for frames {start_frame}-{end_frame}")
            continue

        # Get OCR data for this frame range
        ocr_data = get_ocr_for_caption_range(db_path, start_frame, end_frame)

        if not ocr_data:
            stats["missing_ocr"] += 1
            continue

        # Extract OCR text from annotations
        # Aggregate OCR text from all frames (typically just concatenate)
        ocr_texts = []
        for ocr_frame in ocr_data:
            if ocr_frame.get("ocr_annotations"):
                text = extract_ocr_text_from_annotations(ocr_frame["ocr_annotations"])
                ocr_texts.append(text)

        # Use the most common OCR text or first non-empty one
        ocr_text = max(set(ocr_texts), key=ocr_texts.count) if ocr_texts else ""

        # Compare
        if vlm_text == ocr_text:
            stats["matches"] += 1
            if auto_validate:
                mark_text_as_validated(
                    db_path=db_path,
                    caption_id=caption["id"],
                    validation_source="vlm_ocr_exact_match",
                )
        else:
            stats["mismatches"] += 1
            mismatches.append(
                {
                    "start_frame": start_frame,
                    "end_frame": end_frame,
                    "ocr_text": ocr_text,
                    "vlm_text": vlm_text,
                }
            )

    # Write mismatches to CSV
    if write_mismatches and mismatches:
        mismatch_path = video_dir / "ocr_vs_vlm_mismatches.csv"
        with open(mismatch_path, "w") as f:
            f.write("start_frame,end_frame,ocr_text,vlm_text\n")
            for m in mismatches:
                # Escape commas in text
                ocr_escaped = m["ocr_text"].replace(",", "，")
                vlm_escaped = m["vlm_text"].replace(",", "，")
                f.write(f'{m["start_frame"]},{m["end_frame"]},{ocr_escaped},{vlm_escaped}\n')
        print(f"Wrote {len(mismatches)} mismatches to {mismatch_path}")

    return stats


def load_vlm_results_from_csv(csv_path: Path) -> dict[tuple[int, int], str]:
    """Load VLM inference results from CSV file.

    Expected format: start_frame,end_frame,text

    Args:
        csv_path: Path to VLM results CSV

    Returns:
        Dictionary mapping (start_frame, end_frame) -> text
    """
    results = {}

    with open(csv_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Handle commas in text by splitting on first two commas only
            parts = line.split(",", maxsplit=2)
            if len(parts) < 3:
                continue

            start_frame = int(parts[0])
            end_frame = int(parts[1])
            text = parts[2]

            results[(start_frame, end_frame)] = text

    return results


def compare_from_csv(
    video_dir: Path,
    vlm_csv_path: Path,
    auto_validate: bool = True,
) -> dict[str, Any]:
    """Compare VLM results from CSV file with OCR.

    Args:
        video_dir: Path to video directory
        vlm_csv_path: Path to VLM results CSV
        auto_validate: If True, mark matches as validated

    Returns:
        Comparison statistics dictionary
    """
    vlm_results = load_vlm_results_from_csv(vlm_csv_path)
    return compare_vlm_with_ocr(
        video_dir=video_dir,
        vlm_results=vlm_results,
        auto_validate=auto_validate,
    )
