"""Repository for caption CRUD operations on captions.db."""

import sqlite3

from app.models.captions import (
    Caption,
    CaptionCreate,
    CaptionRow,
    CaptionTextUpdate,
    CaptionUpdate,
    CaptionFrameExtentsState,
    OverlapResolutionResponse,
)


def _row_to_caption_row(row: sqlite3.Row) -> CaptionRow:
    """Convert sqlite3.Row to CaptionRow."""
    return CaptionRow(
        id=row["id"],
        start_frame_index=row["start_frame_index"],
        end_frame_index=row["end_frame_index"],
        caption_frame_extents_state=CaptionFrameExtentsState(row["caption_frame_extents_state"]),
        caption_frame_extents_pending=row["caption_frame_extents_pending"],
        caption_frame_extents_updated_at=row["caption_frame_extents_updated_at"],
        text=row["text"],
        text_pending=row["text_pending"],
        text_status=row["text_status"],
        text_notes=row["text_notes"],
        caption_ocr=row["caption_ocr"],
        text_updated_at=row["text_updated_at"],
        image_needs_regen=row["image_needs_regen"],
        caption_ocr_status=row["caption_ocr_status"],
        caption_ocr_error=row["caption_ocr_error"],
        caption_ocr_processed_at=row["caption_ocr_processed_at"],
        created_at=row["created_at"],
    )


class CaptionRepository:
    """Data access layer for caption operations on captions.db."""

    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize repository with a database connection.

        Args:
            conn: SQLite connection to captions.db (should have row_factory=sqlite3.Row)
        """
        self.conn = conn

    def list_captions(
        self,
        start_frame: int | None = None,
        end_frame: int | None = None,
        workable_only: bool = False,
        limit: int | None = None,
    ) -> list[Caption]:
        """
        List captions, optionally filtered by frame range.

        Args:
            start_frame: Start of frame range (optional, None = no filter)
            end_frame: End of frame range (optional, None = no filter)
            workable_only: If True, only return gaps or pending captions
            limit: Maximum number of captions to return
        """
        conditions = []
        params: list = []

        # Add frame range filter if both provided
        if start_frame is not None and end_frame is not None:
            conditions.append("end_frame_index >= ? AND start_frame_index <= ?")
            params.extend([start_frame, end_frame])

        # Add workable filter
        if workable_only:
            conditions.append("(caption_frame_extents_state = 'gap' OR caption_frame_extents_pending = 1)")

        # Build query
        if conditions:
            query = f"SELECT * FROM captions WHERE {' AND '.join(conditions)} ORDER BY start_frame_index"
        else:
            query = "SELECT * FROM captions ORDER BY start_frame_index"

        if limit:
            query += f" LIMIT {limit}"

        cursor = self.conn.execute(query, params)
        rows = cursor.fetchall()
        return [Caption.from_row(_row_to_caption_row(row)) for row in rows]

    def get_caption(self, caption_id: int) -> Caption | None:
        """Get a single caption by ID."""
        cursor = self.conn.execute("SELECT * FROM captions WHERE id = ?", (caption_id,))
        row = cursor.fetchone()
        if row is None:
            return None
        return Caption.from_row(_row_to_caption_row(row))

    def create_caption(self, input: CaptionCreate) -> Caption:
        """
        Create a new caption.

        Does NOT perform overlap resolution - caller should handle that.
        """
        is_gap = input.captionFrameExtentsState == CaptionFrameExtentsState.GAP
        is_pending = input.captionFrameExtentsPending
        needs_image_regen = 0 if is_gap or is_pending else 1

        cursor = self.conn.execute(
            """
            INSERT INTO captions (
                start_frame_index, end_frame_index, caption_frame_extents_state,
                caption_frame_extents_pending, text, image_needs_regen
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                input.startFrameIndex,
                input.endFrameIndex,
                input.captionFrameExtentsState.value,
                1 if input.captionFrameExtentsPending else 0,
                input.text,
                needs_image_regen,
            ),
        )
        self.conn.commit()

        caption_id = cursor.lastrowid
        return self.get_caption(caption_id)  # type: ignore

    def update_caption_with_overlap_resolution(
        self, caption_id: int, input: CaptionUpdate
    ) -> OverlapResolutionResponse:
        """
        Update caption frame extents with automatic overlap resolution.

        Handles:
        - Deleting captions completely contained in new range
        - Trimming overlapping captions
        - Splitting captions when new range is in the middle
        - Creating gap captions for uncovered ranges when shrinking
        """
        # Get original caption
        original = self._get_caption_row(caption_id)
        if original is None:
            raise ValueError(f"Caption {caption_id} not found")

        # Detect overlapping captions (excluding self)
        overlapping = self._detect_overlaps(
            input.startFrameIndex, input.endFrameIndex, exclude_id=caption_id
        )

        # Resolve overlaps
        deleted_ids: list[int] = []
        modified_captions: list[Caption] = []

        for overlap in overlapping:
            result = self._resolve_overlap(
                overlap, input.startFrameIndex, input.endFrameIndex
            )
            deleted_ids.extend(result["deleted"])
            modified_captions.extend(result["modified"])

        # Create gap captions for uncovered ranges when shrinking
        created_gaps = self._create_gap_captions(
            original, input.startFrameIndex, input.endFrameIndex
        )

        # Check if caption frame extents changed
        boundaries_changed = (
            input.startFrameIndex != original.start_frame_index
            or input.endFrameIndex != original.end_frame_index
        )

        # Update the caption
        self.conn.execute(
            """
            UPDATE captions
            SET start_frame_index = ?,
                end_frame_index = ?,
                caption_frame_extents_state = ?,
                caption_frame_extents_pending = 0,
                image_needs_regen = ?,
                caption_frame_extents_updated_at = datetime('now')
            WHERE id = ?
            """,
            (
                input.startFrameIndex,
                input.endFrameIndex,
                input.captionFrameExtentsState.value,
                1 if boundaries_changed else 0,
                caption_id,
            ),
        )
        self.conn.commit()

        # Get updated caption
        updated = self.get_caption(caption_id)

        return OverlapResolutionResponse(
            caption=updated,  # type: ignore
            deletedCaptions=deleted_ids,
            modifiedCaptions=modified_captions,
            createdGaps=created_gaps,
        )

    def update_caption_text(
        self, caption_id: int, input: CaptionTextUpdate
    ) -> Caption | None:
        """Update caption text and status."""
        self.conn.execute(
            """
            UPDATE captions
            SET text = ?,
                text_status = ?,
                text_notes = ?,
                text_pending = 0,
                text_updated_at = datetime('now')
            WHERE id = ?
            """,
            (
                input.text,
                input.textStatus.value if input.textStatus else None,
                input.textNotes,
                caption_id,
            ),
        )
        self.conn.commit()
        return self.get_caption(caption_id)

    def update_caption_simple(self, caption_id: int, data: dict) -> bool:
        """
        Update caption fields directly without overlap resolution.

        Used by batch operations where client handles overlap logic.

        Args:
            caption_id: ID of caption to update
            data: Dict of field names (camelCase) to values
        """
        if not data:
            return True

        # Map camelCase to snake_case
        field_map = {
            "startFrameIndex": "start_frame_index",
            "endFrameIndex": "end_frame_index",
            "captionFrameExtentsState": "caption_frame_extents_state",
            "text": "text",
            "textStatus": "text_status",
            "textNotes": "text_notes",
        }

        # Build SET clause
        set_parts = []
        params = []
        for camel_key, value in data.items():
            snake_key = field_map.get(camel_key)
            if snake_key:
                # Handle enum values
                if hasattr(value, "value"):
                    value = value.value
                set_parts.append(f"{snake_key} = ?")
                params.append(value)

        if not set_parts:
            return True

        # Add updated timestamp
        set_parts.append("caption_frame_extents_updated_at = datetime('now')")

        params.append(caption_id)
        query = f"UPDATE captions SET {', '.join(set_parts)} WHERE id = ?"

        cursor = self.conn.execute(query, params)
        self.conn.commit()
        return cursor.rowcount > 0

    def delete_caption(self, caption_id: int) -> bool:
        """Delete a caption."""
        cursor = self.conn.execute("DELETE FROM captions WHERE id = ?", (caption_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    def clear_all_captions(self) -> int:
        """Delete all captions. Returns count of deleted rows."""
        cursor = self.conn.execute("DELETE FROM captions")
        self.conn.commit()
        return cursor.rowcount

    # =========================================================================
    # Private helper methods
    # =========================================================================

    def _get_caption_row(self, caption_id: int) -> CaptionRow | None:
        """Get raw caption row."""
        cursor = self.conn.execute("SELECT * FROM captions WHERE id = ?", (caption_id,))
        row = cursor.fetchone()
        if row is None:
            return None
        return _row_to_caption_row(row)

    def _detect_overlaps(
        self, start_frame: int, end_frame: int, exclude_id: int | None = None
    ) -> list[CaptionRow]:
        """Find captions overlapping a frame range."""
        if exclude_id is not None:
            cursor = self.conn.execute(
                """
                SELECT * FROM captions
                WHERE id != ?
                AND NOT (end_frame_index < ? OR start_frame_index > ?)
                """,
                (exclude_id, start_frame, end_frame),
            )
        else:
            cursor = self.conn.execute(
                """
                SELECT * FROM captions
                WHERE NOT (end_frame_index < ? OR start_frame_index > ?)
                """,
                (start_frame, end_frame),
            )
        return [_row_to_caption_row(row) for row in cursor.fetchall()]

    def _resolve_overlap(
        self, overlap: CaptionRow, start_frame: int, end_frame: int
    ) -> dict:
        """
        Resolve a single overlap.

        Returns dict with 'deleted' (list of IDs) and 'modified' (list of Captions).
        """
        deleted: list[int] = []
        modified: list[Caption] = []

        if (
            overlap.start_frame_index >= start_frame
            and overlap.end_frame_index <= end_frame
        ):
            # Completely contained - delete it
            self.conn.execute("DELETE FROM captions WHERE id = ?", (overlap.id,))
            deleted.append(overlap.id)

        elif (
            overlap.start_frame_index < start_frame
            and overlap.end_frame_index > end_frame
        ):
            # New caption is contained within existing - split
            # Keep left part
            self.conn.execute(
                """
                UPDATE captions
                SET end_frame_index = ?, caption_frame_extents_pending = 1
                WHERE id = ?
                """,
                (start_frame - 1, overlap.id),
            )
            left_cap = self.get_caption(overlap.id)
            if left_cap:
                modified.append(left_cap)

            # Create right part
            cursor = self.conn.execute(
                """
                INSERT INTO captions (
                    start_frame_index, end_frame_index, caption_frame_extents_state,
                    caption_frame_extents_pending, text
                )
                VALUES (?, ?, ?, 1, ?)
                """,
                (end_frame + 1, overlap.end_frame_index, overlap.caption_frame_extents_state.value, overlap.text),
            )
            if cursor.lastrowid:
                right_cap = self.get_caption(cursor.lastrowid)
                if right_cap:
                    modified.append(right_cap)

        elif overlap.start_frame_index < start_frame:
            # Overlaps on left - trim right side
            self.conn.execute(
                """
                UPDATE captions
                SET end_frame_index = ?, caption_frame_extents_pending = 1
                WHERE id = ?
                """,
                (start_frame - 1, overlap.id),
            )
            cap = self.get_caption(overlap.id)
            if cap:
                modified.append(cap)

        else:
            # Overlaps on right - trim left side
            self.conn.execute(
                """
                UPDATE captions
                SET start_frame_index = ?, caption_frame_extents_pending = 1
                WHERE id = ?
                """,
                (end_frame + 1, overlap.id),
            )
            cap = self.get_caption(overlap.id)
            if cap:
                modified.append(cap)

        return {"deleted": deleted, "modified": modified}

    def _create_gap_captions(
        self, original: CaptionRow, new_start: int, new_end: int
    ) -> list[Caption]:
        """Create gap captions for uncovered ranges when shrinking."""
        gaps: list[Caption] = []

        # Left gap
        if new_start > original.start_frame_index:
            gap = self._create_or_merge_gap(original.start_frame_index, new_start - 1)
            if gap:
                gaps.append(gap)

        # Right gap
        if new_end < original.end_frame_index:
            gap = self._create_or_merge_gap(new_end + 1, original.end_frame_index)
            if gap:
                gaps.append(gap)

        return gaps

    def _create_or_merge_gap(self, gap_start: int, gap_end: int) -> Caption | None:
        """Create a gap caption, merging with adjacent gaps if present."""
        # Find adjacent gaps
        cursor = self.conn.execute(
            """
            SELECT * FROM captions
            WHERE caption_frame_extents_state = 'gap'
            AND (
                end_frame_index = ? - 1
                OR start_frame_index = ? + 1
            )
            ORDER BY start_frame_index
            """,
            (gap_start, gap_end),
        )
        adjacent_gaps = [_row_to_caption_row(row) for row in cursor.fetchall()]

        # Calculate merged range
        merged_start = gap_start
        merged_end = gap_end
        gap_ids_to_delete: list[int] = []

        for gap in adjacent_gaps:
            if gap.end_frame_index == gap_start - 1:
                merged_start = gap.start_frame_index
                gap_ids_to_delete.append(gap.id)
            elif gap.start_frame_index == gap_end + 1:
                merged_end = gap.end_frame_index
                gap_ids_to_delete.append(gap.id)

        # Delete adjacent gaps
        for gap_id in gap_ids_to_delete:
            self.conn.execute("DELETE FROM captions WHERE id = ?", (gap_id,))

        # Create merged gap
        cursor = self.conn.execute(
            """
            INSERT INTO captions (
                start_frame_index, end_frame_index, caption_frame_extents_state, caption_frame_extents_pending
            )
            VALUES (?, ?, 'gap', 0)
            """,
            (merged_start, merged_end),
        )
        self.conn.commit()

        if cursor.lastrowid:
            return self.get_caption(cursor.lastrowid)
        return None
