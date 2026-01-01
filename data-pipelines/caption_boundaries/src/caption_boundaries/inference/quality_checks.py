"""Quality checks for boundary predictions.

Validates predictions using OCR confidence, text similarity, and coherence checks.
"""

import sqlite3
from pathlib import Path
from typing import Any

import Levenshtein
from rich.console import Console

console = Console(stderr=True)


def get_ocr_data_for_frame(video_db_path: Path, frame_index: int) -> dict[str, Any]:
    """Get OCR confidence and text for a frame.

    Args:
        video_db_path: Path to video's annotations.db
        frame_index: Frame index

    Returns:
        Dict with ocr_confidence and ocr_text
    """
    # TODO: Currently gracefully handles missing/incompatible OCR data.
    # Should enforce normalized schema once all DBs migrated via backfill_ocr.py.
    try:
        conn = sqlite3.connect(video_db_path)
        cursor = conn.cursor()

        # Query normalized schema (one row per OCR box)
        cursor.execute("""
            SELECT AVG(confidence), GROUP_CONCAT(text, '')
            FROM cropped_frame_ocr
            WHERE frame_index = ?
        """, (frame_index,))

        result = cursor.fetchone()
        conn.close()

        if result and result[0] is not None:
            return {
                "ocr_confidence": result[0],
                "ocr_text": result[1] or "",
            }
        else:
            return {
                "ocr_confidence": 0.0,
                "ocr_text": "",
            }

    except Exception:
        # Gracefully handle missing table, wrong schema, or any DB errors
        return {
            "ocr_confidence": 0.0,
            "ocr_text": "",
        }


def check_ocr_confidence(
    video_db_path: Path,
    frame_index: int,
    min_confidence: float = 0.7,
) -> dict[str, Any]:
    """Check if OCR confidence meets threshold.

    Args:
        video_db_path: Path to video's annotations.db
        frame_index: Frame index
        min_confidence: Minimum required confidence

    Returns:
        Dict with passed (bool) and actual confidence
    """
    ocr_data = get_ocr_data_for_frame(video_db_path, frame_index)
    confidence = ocr_data["ocr_confidence"]

    return {
        "passed": confidence >= min_confidence,
        "confidence": confidence,
        "threshold": min_confidence,
    }


def check_text_similarity(
    video_db_path: Path,
    frame1_index: int,
    frame2_index: int,
    predicted_label: str,
) -> dict[str, Any]:
    """Check if text similarity matches predicted label.

    For "same" predictions, texts should be similar.
    For "different" predictions, texts should be different.

    Args:
        video_db_path: Path to video's annotations.db
        frame1_index: First frame index
        frame2_index: Second frame index
        predicted_label: Predicted boundary label

    Returns:
        Dict with coherence check results
    """
    ocr1 = get_ocr_data_for_frame(video_db_path, frame1_index)
    ocr2 = get_ocr_data_for_frame(video_db_path, frame2_index)

    text1 = ocr1["ocr_text"].strip()
    text2 = ocr2["ocr_text"].strip()

    # Calculate Levenshtein distance
    if text1 and text2:
        lev_distance = Levenshtein.distance(text1, text2)
        max_len = max(len(text1), len(text2))
        similarity = 1.0 - (lev_distance / max_len) if max_len > 0 else 0.0
    else:
        lev_distance = None
        similarity = 0.0

    # Check coherence
    if predicted_label == "same":
        # Texts should be similar (high similarity)
        coherent = similarity > 0.8
    elif predicted_label == "different":
        # Texts should be different (low similarity)
        coherent = similarity < 0.8
    elif predicted_label in ("empty_empty", "empty_valid", "valid_empty"):
        # At least one text should be empty
        coherent = not text1 or not text2
    else:
        coherent = True  # Unknown label, assume coherent

    return {
        "coherent": coherent,
        "similarity": similarity,
        "levenshtein_distance": lev_distance,
        "text1": text1,
        "text2": text2,
    }


def check_boundary_coherence(
    boundaries: list[dict[str, Any]],
) -> dict[str, Any]:
    """Check overall coherence of boundary sequence.

    Validates that boundaries make sense in sequence (e.g., no isolated "same" predictions).

    Args:
        boundaries: List of predicted boundaries

    Returns:
        Dict with coherence metrics
    """
    if len(boundaries) < 2:
        return {
            "coherent": True,
            "issues": [],
        }

    issues = []

    # Check for suspicious patterns
    for i in range(len(boundaries) - 1):
        curr = boundaries[i]
        next_bound = boundaries[i + 1]

        # Check: Two consecutive "different" predictions should have a gap
        if curr["predicted_label"] == "different" and next_bound["predicted_label"] == "different":
            gap = next_bound["frame1_index"] - curr["frame2_index"]
            if gap < 2:
                issues.append({
                    "type": "consecutive_boundaries",
                    "frames": (curr["frame1_index"], curr["frame2_index"], next_bound["frame1_index"]),
                    "message": "Two boundaries with no gap between them",
                })

    return {
        "coherent": len(issues) == 0,
        "issues": issues,
    }


def run_quality_checks(
    video_db_path: Path,
    boundaries: list[dict[str, Any]],
    ocr_confidence_min: float = 0.7,
) -> dict[str, Any]:
    """Run comprehensive quality checks on predicted boundaries.

    Args:
        video_db_path: Path to video's annotations.db
        boundaries: List of predicted boundaries
        ocr_confidence_min: Minimum OCR confidence threshold

    Returns:
        Dict with quality check results and flagged boundaries
    """
    flagged_boundaries = []
    quality_stats = {
        "total_boundaries": len(boundaries),
        "low_ocr_confidence": 0,
        "text_incoherent": 0,
        "sequence_issues": 0,
    }

    # Check each boundary
    for boundary in boundaries:
        frame1 = boundary["frame1_index"]
        frame2 = boundary["frame2_index"]
        label = boundary["predicted_label"]

        flags = []

        # Check OCR confidence for both frames
        ocr1_check = check_ocr_confidence(video_db_path, frame1, ocr_confidence_min)
        ocr2_check = check_ocr_confidence(video_db_path, frame2, ocr_confidence_min)

        if not ocr1_check["passed"]:
            flags.append(f"Low OCR confidence frame1: {ocr1_check['confidence']:.2f}")
            quality_stats["low_ocr_confidence"] += 1

        if not ocr2_check["passed"]:
            flags.append(f"Low OCR confidence frame2: {ocr2_check['confidence']:.2f}")
            quality_stats["low_ocr_confidence"] += 1

        # Check text similarity coherence
        similarity_check = check_text_similarity(video_db_path, frame1, frame2, label)
        if not similarity_check["coherent"]:
            flags.append(
                f"Text mismatch: predicted {label} but similarity={similarity_check['similarity']:.2f}"
            )
            quality_stats["text_incoherent"] += 1

        if flags:
            flagged_boundaries.append({
                **boundary,
                "flags": flags,
                "ocr1_confidence": ocr1_check["confidence"],
                "ocr2_confidence": ocr2_check["confidence"],
                "text_similarity": similarity_check["similarity"],
            })

    # Check sequence coherence
    coherence_check = check_boundary_coherence(boundaries)
    if not coherence_check["coherent"]:
        quality_stats["sequence_issues"] = len(coherence_check["issues"])

    # Summary
    pass_rate = (len(boundaries) - len(flagged_boundaries)) / len(boundaries) if boundaries else 1.0

    console.print(f"\n[cyan]Quality Check Summary:[/cyan]")
    console.print(f"  Total boundaries: {quality_stats['total_boundaries']}")
    console.print(f"  Flagged: {len(flagged_boundaries)}")
    console.print(f"  Pass rate: {pass_rate*100:.1f}%")
    console.print(f"  Low OCR confidence: {quality_stats['low_ocr_confidence']}")
    console.print(f"  Text incoherent: {quality_stats['text_incoherent']}")
    console.print(f"  Sequence issues: {quality_stats['sequence_issues']}")

    return {
        "flagged_boundaries": flagged_boundaries,
        "quality_stats": quality_stats,
        "coherence_check": coherence_check,
        "pass_rate": pass_rate,
    }
