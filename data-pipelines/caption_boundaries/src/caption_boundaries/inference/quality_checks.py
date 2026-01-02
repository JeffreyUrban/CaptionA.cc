"""Quality checks for boundary predictions.

Validates predictions using sequence coherence checks.
"""

from pathlib import Path
from typing import Any

from rich.console import Console

console = Console(stderr=True)


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
    """Run quality checks on predicted boundaries.

    Args:
        video_db_path: Path to video's annotations.db (unused, kept for API compatibility)
        boundaries: List of predicted boundaries
        ocr_confidence_min: Minimum OCR confidence threshold (unused, kept for API compatibility)

    Returns:
        Dict with quality check results and flagged boundaries
    """
    quality_stats = {
        "total_boundaries": len(boundaries),
        "sequence_issues": 0,
    }

    # Check sequence coherence
    coherence_check = check_boundary_coherence(boundaries)
    if not coherence_check["coherent"]:
        quality_stats["sequence_issues"] = len(coherence_check["issues"])

    # Flag boundaries with coherence issues
    flagged_boundaries = []
    if coherence_check["issues"]:
        # Map issues to affected boundaries
        issue_frames = {issue["frames"] for issue in coherence_check["issues"]}
        for boundary in boundaries:
            # Check if this boundary is part of any issue
            for frames in issue_frames:
                if boundary["frame1_index"] in frames or boundary["frame2_index"] in frames:
                    flagged_boundaries.append({
                        **boundary,
                        "flags": [issue["message"] for issue in coherence_check["issues"]
                                if boundary["frame1_index"] in issue["frames"]
                                or boundary["frame2_index"] in issue["frames"]],
                    })
                    break

    # Summary
    pass_rate = (len(boundaries) - len(flagged_boundaries)) / len(boundaries) if boundaries else 1.0

    console.print(f"\n[cyan]Quality Check Summary:[/cyan]")
    console.print(f"  Total boundaries: {quality_stats['total_boundaries']}")
    console.print(f"  Flagged: {len(flagged_boundaries)}")
    console.print(f"  Pass rate: {pass_rate*100:.1f}%")
    console.print(f"  Sequence issues: {quality_stats['sequence_issues']}")

    return {
        "flagged_boundaries": flagged_boundaries,
        "quality_stats": quality_stats,
        "coherence_check": coherence_check,
        "pass_rate": pass_rate,
    }
