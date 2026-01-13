"""Quality checks for caption frame extents predictions.

Validates predictions using sequence coherence checks.
"""

from pathlib import Path
from typing import Any

from rich.console import Console

console = Console(stderr=True)


def check_caption_frame_extents_coherence(
    caption_frame_extents: list[dict[str, Any]],
) -> dict[str, Any]:
    """Check overall coherence of caption frame extents sequence.

    Validates that caption frame extents make sense in sequence (e.g., no isolated "same" predictions).

    Args:
        caption_frame_extents: List of predicted caption frame extents

    Returns:
        Dict with coherence metrics
    """
    if len(caption_frame_extents) < 2:
        return {
            "coherent": True,
            "issues": [],
        }

    issues = []

    # Check for suspicious patterns
    for i in range(len(caption_frame_extents) - 1):
        curr = caption_frame_extents[i]
        next_caption_frame_extent = caption_frame_extents[i + 1]

        # Check: Two consecutive "different" predictions should have a gap
        if curr["predicted_label"] == "different" and next_caption_frame_extent["predicted_label"] == "different":
            gap = next_caption_frame_extent["frame1_index"] - curr["frame2_index"]
            if gap < 2:
                issues.append(
                    {
                        "type": "consecutive_caption_frame_extents",
                        "frames": (curr["frame1_index"], curr["frame2_index"], next_caption_frame_extent["frame1_index"]),
                        "message": "Two caption frame extents with no gap between them",
                    }
                )

    return {
        "coherent": len(issues) == 0,
        "issues": issues,
    }


def run_quality_checks(
    video_db_path: Path,
    caption_frame_extents: list[dict[str, Any]],
    ocr_confidence_min: float = 0.7,
) -> dict[str, Any]:
    """Run quality checks on predicted caption frame extents.

    Args:
        video_db_path: Path to video's captions.db (unused, kept for API compatibility)
        caption_frame_extents: List of predicted caption frame extents
        ocr_confidence_min: Minimum OCR confidence threshold (unused, kept for API compatibility)

    Returns:
        Dict with quality check results and flagged caption frame extents
    """
    quality_stats = {
        "total_caption_frame_extents": len(caption_frame_extents),
        "sequence_issues": 0,
    }

    # Check sequence coherence
    coherence_check = check_caption_frame_extents_coherence(caption_frame_extents)
    if not coherence_check["coherent"]:
        quality_stats["sequence_issues"] = len(coherence_check["issues"])

    # Flag caption frame extents with coherence issues
    flagged_caption_frame_extents = []
    if coherence_check["issues"]:
        # Map issues to affected caption frame extents
        issue_frames = {issue["frames"] for issue in coherence_check["issues"]}
        for caption_frame_extent in caption_frame_extents:
            # Check if this caption frame extent is part of any issue
            for frames in issue_frames:
                if caption_frame_extent["frame1_index"] in frames or caption_frame_extent["frame2_index"] in frames:
                    flagged_caption_frame_extents.append(
                        {
                            **caption_frame_extent,
                            "flags": [
                                issue["message"]
                                for issue in coherence_check["issues"]
                                if caption_frame_extent["frame1_index"] in issue["frames"]
                                or caption_frame_extent["frame2_index"] in issue["frames"]
                            ],
                        }
                    )
                    break

    # Summary
    pass_rate = (len(caption_frame_extents) - len(flagged_caption_frame_extents)) / len(caption_frame_extents) if caption_frame_extents else 1.0

    console.print("\n[cyan]Quality Check Summary:[/cyan]")
    console.print(f"  Total caption frame extents: {quality_stats['total_caption_frame_extents']}")
    console.print(f"  Flagged: {len(flagged_caption_frame_extents)}")
    console.print(f"  Pass rate: {pass_rate * 100:.1f}%")
    console.print(f"  Sequence issues: {quality_stats['sequence_issues']}")

    return {
        "flagged_caption_frame_extents": flagged_caption_frame_extents,
        "quality_stats": quality_stats,
        "coherence_check": coherence_check,
        "pass_rate": pass_rate,
    }
