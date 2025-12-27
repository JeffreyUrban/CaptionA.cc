"""Auto-selection of reference frames for FontCLIP embeddings.

Selects the best frame from a video to extract font style embeddings using FontCLIP.
Selection prioritizes frames with:
1. Highest number of OCR boxes per frame
2. Highest mean OCR confidence among top candidates
3. Sufficient text coverage (filters out sparse frames)
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class ReferenceFrameCandidate:
    """Candidate frame for FontCLIP reference selection."""

    frame_index: int
    num_ocr_boxes: int
    mean_confidence: float
    ocr_boxes: list[dict[str, Any]]


def select_reference_frame(
    db_path: Path,
    min_ocr_boxes: int = 10,
    min_confidence: float = 0.7,
    top_k: int = 5,
) -> ReferenceFrameCandidate | None:
    """Select best reference frame for FontCLIP embedding extraction.

    Selection strategy:
    1. Filter frames with at least min_ocr_boxes OCR boxes
    2. Filter frames with mean confidence >= min_confidence
    3. Rank by number of OCR boxes (descending)
    4. Among top_k candidates, select frame with highest mean confidence

    Args:
        db_path: Path to video's annotations.db
        min_ocr_boxes: Minimum OCR boxes required (default 10)
        min_confidence: Minimum mean confidence required (default 0.7)
        top_k: Number of top candidates to consider (default 5)

    Returns:
        Best reference frame candidate, or None if no frames meet criteria

    Example:
        >>> db_path = Path("path/to/video/annotations.db")
        >>> ref = select_reference_frame(db_path)
        >>> if ref:
        ...     print(f"Selected frame {ref.frame_index} with {ref.num_ocr_boxes} boxes")
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row  # Access columns by name
    cursor = conn.cursor()

    try:
        # Aggregate OCR boxes by frame_index
        # Calculate count and mean confidence per frame
        cursor.execute(
            """
            SELECT
                frame_index,
                COUNT(*) as num_boxes,
                AVG(confidence) as mean_confidence
            FROM full_frame_ocr
            GROUP BY frame_index
            HAVING num_boxes >= ? AND mean_confidence >= ?
            ORDER BY num_boxes DESC
            LIMIT ?
        """,
            (min_ocr_boxes, min_confidence, top_k),
        )

        candidates = cursor.fetchall()

        if not candidates:
            return None

        # Among top_k candidates, find highest mean confidence
        best_frame = max(candidates, key=lambda row: row["mean_confidence"])
        best_frame_index = best_frame["frame_index"]

        # Get all OCR boxes for the selected frame
        cursor.execute(
            """
            SELECT text, confidence, x, y, width, height
            FROM full_frame_ocr
            WHERE frame_index = ?
            ORDER BY box_index
        """,
            (best_frame_index,),
        )

        boxes = cursor.fetchall()
        boxes_dict = [
            {
                "text": box["text"],
                "confidence": box["confidence"],
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],
            }
            for box in boxes
        ]

        return ReferenceFrameCandidate(
            frame_index=best_frame_index,
            num_ocr_boxes=best_frame["num_boxes"],
            mean_confidence=best_frame["mean_confidence"],
            ocr_boxes=boxes_dict,
        )

    finally:
        conn.close()


def select_reference_frame_simple(
    ocr_data: list[dict[str, Any]],
    min_ocr_boxes: int = 10,
    min_confidence: float = 0.7,
) -> int | None:
    """Simplified reference frame selection from pre-aggregated OCR data.

    This is a simpler version for when you already have OCR data aggregated
    by frame and don't need to query the database.

    Args:
        ocr_data: List of dicts with keys: frame_index, num_boxes, mean_confidence
        min_ocr_boxes: Minimum OCR boxes required
        min_confidence: Minimum mean confidence required

    Returns:
        Best frame index, or None if no frames meet criteria

    Example:
        >>> ocr_data = [
        ...     {"frame_index": 10, "num_boxes": 25, "mean_confidence": 0.92},
        ...     {"frame_index": 20, "num_boxes": 30, "mean_confidence": 0.88},
        ...     {"frame_index": 30, "num_boxes": 15, "mean_confidence": 0.95},
        ... ]
        >>> best_frame = select_reference_frame_simple(ocr_data)
        >>> print(best_frame)
        20
    """
    # Filter by criteria
    candidates = [
        frame
        for frame in ocr_data
        if frame["num_boxes"] >= min_ocr_boxes and frame["mean_confidence"] >= min_confidence
    ]

    if not candidates:
        return None

    # Sort by num_boxes descending, then by mean_confidence descending
    candidates.sort(key=lambda f: (f["num_boxes"], f["mean_confidence"]), reverse=True)

    return candidates[0]["frame_index"]


def get_reference_frame_stats(db_path: Path) -> dict[str, Any]:
    """Get statistics about potential reference frames for a video.

    Useful for debugging and understanding reference frame selection.

    Args:
        db_path: Path to video's annotations.db

    Returns:
        Dict with statistics:
            - total_frames: Total number of full frames with OCR
            - frames_with_ocr: Number of frames with at least 1 OCR box
            - max_ocr_boxes: Maximum OCR boxes in any frame
            - mean_ocr_boxes: Average OCR boxes across frames with OCR
            - max_confidence: Highest mean confidence across frames
            - frames_above_threshold: Number of frames meeting selection criteria (>=10 boxes)

    Example:
        >>> stats = get_reference_frame_stats(Path("annotations.db"))
        >>> print(f"Frames with OCR: {stats['frames_with_ocr']}")
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Get frame-level statistics
        cursor.execute(
            """
            SELECT
                COUNT(DISTINCT frame_index) as total_frames,
                MAX(box_count) as max_ocr_boxes,
                AVG(box_count) as mean_ocr_boxes,
                MAX(mean_conf) as max_confidence,
                SUM(CASE WHEN box_count >= 10 THEN 1 ELSE 0 END) as frames_above_threshold
            FROM (
                SELECT
                    frame_index,
                    COUNT(*) as box_count,
                    AVG(confidence) as mean_conf
                FROM full_frame_ocr
                GROUP BY frame_index
            )
        """
        )

        row = cursor.fetchone()

        return {
            "total_frames": row["total_frames"] or 0,
            "frames_with_ocr": row["total_frames"] or 0,  # Same as total_frames
            "max_ocr_boxes": row["max_ocr_boxes"] or 0,
            "mean_ocr_boxes": row["mean_ocr_boxes"] or 0.0,
            "max_confidence": row["max_confidence"] or 0.0,
            "frames_above_threshold": row["frames_above_threshold"] or 0,
        }

    finally:
        conn.close()


def get_all_frame_candidates(
    db_path: Path,
    min_ocr_boxes: int = 1,
    min_confidence: float = 0.0,
) -> list[dict[str, Any]]:
    """Get all frames with their OCR statistics for analysis.

    Useful for debugging and visualization of frame selection.

    Args:
        db_path: Path to video's annotations.db
        min_ocr_boxes: Minimum OCR boxes required (default 1)
        min_confidence: Minimum mean confidence required (default 0.0)

    Returns:
        List of frame statistics, sorted by num_boxes descending

    Example:
        >>> frames = get_all_frame_candidates(Path("annotations.db"), min_ocr_boxes=10)
        >>> for frame in frames[:5]:
        ...     print(f"Frame {frame['frame_index']}: {frame['num_boxes']} boxes, conf={frame['mean_confidence']:.2f}")
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            SELECT
                frame_index,
                COUNT(*) as num_boxes,
                AVG(confidence) as mean_confidence,
                MIN(confidence) as min_confidence,
                MAX(confidence) as max_confidence
            FROM full_frame_ocr
            GROUP BY frame_index
            HAVING num_boxes >= ? AND mean_confidence >= ?
            ORDER BY num_boxes DESC, mean_confidence DESC
        """,
            (min_ocr_boxes, min_confidence),
        )

        return [
            {
                "frame_index": row["frame_index"],
                "num_boxes": row["num_boxes"],
                "mean_confidence": row["mean_confidence"],
                "min_confidence": row["min_confidence"],
                "max_confidence": row["max_confidence"],
            }
            for row in cursor.fetchall()
        ]

    finally:
        conn.close()
