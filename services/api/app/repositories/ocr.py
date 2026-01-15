"""Repository for OCR read operations on fullOCR.db."""

import sqlite3

from app.models.ocr import (
    FrameOcrResult,
    FullFrameOcrRow,
    OcrDetection,
)


def _row_to_ocr_row(row: sqlite3.Row) -> FullFrameOcrRow:
    """Convert sqlite3.Row to FullFrameOcrRow."""
    return FullFrameOcrRow(
        id=row["id"],
        frame_id=row["frame_id"],
        frame_index=row["frame_index"],
        box_index=row["box_index"],
        text=row["text"],
        confidence=row["confidence"],
        bbox_left=row["bbox_left"],
        bbox_top=row["bbox_top"],
        bbox_right=row["bbox_right"],
        bbox_bottom=row["bbox_bottom"],
        created_at=row["created_at"],
    )


class OcrRepository:
    """Data access layer for OCR read operations on fullOCR.db."""

    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize repository with a database connection.

        Args:
            conn: SQLite connection to fullOCR.db (should have row_factory=sqlite3.Row)
        """
        self.conn = conn

    def list_detections(
        self,
        frame_index: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[OcrDetection]:
        """
        List OCR detections with optional filtering.

        Args:
            frame_index: Filter by frame index
            limit: Maximum number of detections to return
            offset: Number of detections to skip
        """
        conditions: list[str] = []
        params: list[int] = []

        if frame_index is not None:
            conditions.append("frame_index = ?")
            params.append(frame_index)

        query = "SELECT * FROM full_frame_ocr"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY frame_index, box_index"

        if limit:
            query += f" LIMIT {limit}"
            if offset:
                query += f" OFFSET {offset}"

        cursor = self.conn.execute(query, params)
        rows = cursor.fetchall()
        return [OcrDetection.from_row(_row_to_ocr_row(row)) for row in rows]

    def get_detection(self, detection_id: int) -> OcrDetection | None:
        """Get a single OCR detection by ID."""
        cursor = self.conn.execute(
            "SELECT * FROM full_frame_ocr WHERE id = ?", (detection_id,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return OcrDetection.from_row(_row_to_ocr_row(row))

    def get_frame_ocr(self, frame_index: int) -> FrameOcrResult | None:
        """
        Get all OCR detections for a specific frame.

        Returns None if no detections exist for the frame.
        """
        detections = self.list_detections(frame_index=frame_index)
        if not detections:
            return None

        return FrameOcrResult(
            frameIndex=frame_index,
            detections=detections,
            totalDetections=len(detections),
        )

    def list_frames_with_ocr(
        self,
        start_frame: int | None = None,
        end_frame: int | None = None,
        limit: int | None = None,
    ) -> list[FrameOcrResult]:
        """
        List frames that have OCR detections.

        Args:
            start_frame: Start of frame range (inclusive)
            end_frame: End of frame range (inclusive)
            limit: Maximum number of frames to return
        """
        conditions: list[str] = []
        params: list[int] = []

        if start_frame is not None:
            conditions.append("frame_index >= ?")
            params.append(start_frame)
        if end_frame is not None:
            conditions.append("frame_index <= ?")
            params.append(end_frame)

        # Get distinct frame indices
        query = "SELECT DISTINCT frame_index FROM full_frame_ocr"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY frame_index"

        if limit:
            query += f" LIMIT {limit}"

        cursor = self.conn.execute(query, params)
        frame_indices = [row["frame_index"] for row in cursor.fetchall()]

        # Get OCR results for each frame
        results: list[FrameOcrResult] = []
        for frame_idx in frame_indices:
            frame_result = self.get_frame_ocr(frame_idx)
            if frame_result:
                results.append(frame_result)

        return results

    def get_detections_in_range(
        self,
        start_frame: int,
        end_frame: int,
        limit: int | None = None,
    ) -> list[OcrDetection]:
        """
        Get all OCR detections within a frame range.

        Args:
            start_frame: Start of frame range (inclusive)
            end_frame: End of frame range (inclusive)
            limit: Maximum number of detections to return
        """
        query = """
            SELECT * FROM full_frame_ocr
            WHERE frame_index >= ? AND frame_index <= ?
            ORDER BY frame_index, box_index
        """
        if limit:
            query += f" LIMIT {limit}"

        cursor = self.conn.execute(query, (start_frame, end_frame))
        rows = cursor.fetchall()
        return [OcrDetection.from_row(_row_to_ocr_row(row)) for row in rows]

    def search_text(
        self,
        query_text: str,
        limit: int | None = None,
    ) -> list[OcrDetection]:
        """
        Search for OCR detections containing specific text.

        Args:
            query_text: Text to search for (case-insensitive LIKE search)
            limit: Maximum number of detections to return
        """
        query = """
            SELECT * FROM full_frame_ocr
            WHERE text LIKE ?
            ORDER BY frame_index, box_index
        """
        if limit:
            query += f" LIMIT {limit}"

        cursor = self.conn.execute(query, (f"%{query_text}%",))
        rows = cursor.fetchall()
        return [OcrDetection.from_row(_row_to_ocr_row(row)) for row in rows]

    def get_stats(self) -> dict:
        """Get OCR statistics for the video."""
        # Total detections
        cursor = self.conn.execute("SELECT COUNT(*) as count FROM full_frame_ocr")
        total_detections = cursor.fetchone()["count"]

        # Frames with OCR
        cursor = self.conn.execute(
            "SELECT COUNT(DISTINCT frame_index) as count FROM full_frame_ocr"
        )
        frames_with_ocr = cursor.fetchone()["count"]

        # Average detections per frame
        avg_per_frame = (
            total_detections / frames_with_ocr if frames_with_ocr > 0 else 0.0
        )

        return {
            "total_detections": total_detections,
            "frames_with_ocr": frames_with_ocr,
            "avg_detections_per_frame": round(avg_per_frame, 2),
        }

    def get_frame_indices(self) -> list[int]:
        """Get all frame indices that have OCR data."""
        cursor = self.conn.execute(
            "SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index"
        )
        return [row["frame_index"] for row in cursor.fetchall()]

    def count_detections(self, frame_index: int | None = None) -> int:
        """Count OCR detections, optionally filtered by frame."""
        if frame_index is not None:
            cursor = self.conn.execute(
                "SELECT COUNT(*) as count FROM full_frame_ocr WHERE frame_index = ?",
                (frame_index,),
            )
        else:
            cursor = self.conn.execute("SELECT COUNT(*) as count FROM full_frame_ocr")
        return cursor.fetchone()["count"]
