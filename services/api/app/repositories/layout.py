"""Repository for layout CRUD operations on layout.db."""

import sqlite3

from app.models.layout import (
    AnalysisResultsUpdate,
    BoxLabelCreate,
    FrameBoxLabel,
    FullFrameBoxLabelRow,
    LabelSource,
    VideoLayoutConfig,
    VideoLayoutConfigInit,
    VideoLayoutConfigRow,
    VideoLayoutConfigUpdate,
    VideoPreferences,
    VideoPreferencesRow,
    VideoPreferencesUpdate,
)


def _row_to_layout_config_row(row: sqlite3.Row) -> VideoLayoutConfigRow:
    """Convert sqlite3.Row to VideoLayoutConfigRow."""
    return VideoLayoutConfigRow(
        id=row["id"],
        frame_width=row["frame_width"],
        frame_height=row["frame_height"],
        crop_left=row["crop_left"],
        crop_top=row["crop_top"],
        crop_right=row["crop_right"],
        crop_bottom=row["crop_bottom"],
        selection_left=row["selection_left"],
        selection_top=row["selection_top"],
        selection_right=row["selection_right"],
        selection_bottom=row["selection_bottom"],
        selection_mode=row["selection_mode"],
        vertical_position=row["vertical_position"],
        vertical_std=row["vertical_std"],
        box_height=row["box_height"],
        box_height_std=row["box_height_std"],
        anchor_type=row["anchor_type"],
        anchor_position=row["anchor_position"],
        top_edge_std=row["top_edge_std"],
        bottom_edge_std=row["bottom_edge_std"],
        horizontal_std_slope=row["horizontal_std_slope"],
        horizontal_std_intercept=row["horizontal_std_intercept"],
        crop_bounds_version=row["crop_bounds_version"],
        analysis_model_version=row["analysis_model_version"],
        updated_at=row["updated_at"],
    )


def _row_to_box_label_row(row: sqlite3.Row) -> FullFrameBoxLabelRow:
    """Convert sqlite3.Row to FullFrameBoxLabelRow."""
    return FullFrameBoxLabelRow(
        id=row["id"],
        frame_index=row["frame_index"],
        box_index=row["box_index"],
        label=row["label"],
        label_source=row["label_source"],
        created_at=row["created_at"],
    )


def _row_to_preferences_row(row: sqlite3.Row) -> VideoPreferencesRow:
    """Convert sqlite3.Row to VideoPreferencesRow."""
    return VideoPreferencesRow(
        id=row["id"],
        layout_approved=row["layout_approved"],
    )


class LayoutRepository:
    """Data access layer for layout operations on layout.db."""

    def __init__(self, conn: sqlite3.Connection):
        """
        Initialize repository with a database connection.

        Args:
            conn: SQLite connection to layout.db (should have row_factory=sqlite3.Row)
        """
        self.conn = conn

    # =========================================================================
    # Video Layout Config Operations
    # =========================================================================

    def get_layout_config(self) -> VideoLayoutConfig | None:
        """Get the video layout configuration (single-row table)."""
        cursor = self.conn.execute("SELECT * FROM video_layout_config WHERE id = 1")
        row = cursor.fetchone()
        if row is None:
            return None
        return VideoLayoutConfig.from_row(_row_to_layout_config_row(row))

    def init_layout_config(self, input: VideoLayoutConfigInit) -> VideoLayoutConfig:
        """
        Initialize video layout config with frame dimensions.

        Creates a new config row if one doesn't exist, or updates existing.
        """
        existing = self.get_layout_config()
        if existing:
            # Update frame dimensions
            self.conn.execute(
                """
                UPDATE video_layout_config
                SET frame_width = ?, frame_height = ?, updated_at = datetime('now')
                WHERE id = 1
                """,
                (input.frameWidth, input.frameHeight),
            )
        else:
            # Create new config
            self.conn.execute(
                """
                INSERT INTO video_layout_config (id, frame_width, frame_height)
                VALUES (1, ?, ?)
                """,
                (input.frameWidth, input.frameHeight),
            )
        self.conn.commit()
        return self.get_layout_config()  # type: ignore

    def update_layout_config(self, input: VideoLayoutConfigUpdate) -> VideoLayoutConfig | None:
        """Update crop bounds and selection region."""
        updates: list[str] = []
        params: list[int | str] = []

        if input.cropLeft is not None:
            updates.append("crop_left = ?")
            params.append(input.cropLeft)
        if input.cropTop is not None:
            updates.append("crop_top = ?")
            params.append(input.cropTop)
        if input.cropRight is not None:
            updates.append("crop_right = ?")
            params.append(input.cropRight)
        if input.cropBottom is not None:
            updates.append("crop_bottom = ?")
            params.append(input.cropBottom)
        if input.selectionLeft is not None:
            updates.append("selection_left = ?")
            params.append(input.selectionLeft)
        if input.selectionTop is not None:
            updates.append("selection_top = ?")
            params.append(input.selectionTop)
        if input.selectionRight is not None:
            updates.append("selection_right = ?")
            params.append(input.selectionRight)
        if input.selectionBottom is not None:
            updates.append("selection_bottom = ?")
            params.append(input.selectionBottom)
        if input.selectionMode is not None:
            updates.append("selection_mode = ?")
            params.append(input.selectionMode.value)

        if not updates:
            return self.get_layout_config()

        # Increment crop_bounds_version when crop bounds change
        if any(
            x is not None
            for x in [input.cropLeft, input.cropTop, input.cropRight, input.cropBottom]
        ):
            updates.append("crop_bounds_version = crop_bounds_version + 1")

        updates.append("updated_at = datetime('now')")

        query = f"UPDATE video_layout_config SET {', '.join(updates)} WHERE id = 1"
        self.conn.execute(query, params)
        self.conn.commit()

        return self.get_layout_config()

    def update_analysis_results(self, input: AnalysisResultsUpdate) -> VideoLayoutConfig | None:
        """Update layout analysis results from ML model."""
        updates: list[str] = []
        params: list[float | str] = []

        if input.verticalPosition is not None:
            updates.append("vertical_position = ?")
            params.append(input.verticalPosition)
        if input.verticalStd is not None:
            updates.append("vertical_std = ?")
            params.append(input.verticalStd)
        if input.boxHeight is not None:
            updates.append("box_height = ?")
            params.append(input.boxHeight)
        if input.boxHeightStd is not None:
            updates.append("box_height_std = ?")
            params.append(input.boxHeightStd)
        if input.anchorType is not None:
            updates.append("anchor_type = ?")
            params.append(input.anchorType)
        if input.anchorPosition is not None:
            updates.append("anchor_position = ?")
            params.append(input.anchorPosition)
        if input.topEdgeStd is not None:
            updates.append("top_edge_std = ?")
            params.append(input.topEdgeStd)
        if input.bottomEdgeStd is not None:
            updates.append("bottom_edge_std = ?")
            params.append(input.bottomEdgeStd)
        if input.horizontalStdSlope is not None:
            updates.append("horizontal_std_slope = ?")
            params.append(input.horizontalStdSlope)
        if input.horizontalStdIntercept is not None:
            updates.append("horizontal_std_intercept = ?")
            params.append(input.horizontalStdIntercept)
        if input.analysisModelVersion is not None:
            updates.append("analysis_model_version = ?")
            params.append(input.analysisModelVersion)

        if not updates:
            return self.get_layout_config()

        updates.append("updated_at = datetime('now')")

        query = f"UPDATE video_layout_config SET {', '.join(updates)} WHERE id = 1"
        self.conn.execute(query, params)
        self.conn.commit()

        return self.get_layout_config()

    # =========================================================================
    # Box Label Operations
    # =========================================================================

    def list_box_labels(
        self,
        frame_index: int | None = None,
        label_source: LabelSource | None = None,
        limit: int | None = None,
    ) -> list[FrameBoxLabel]:
        """
        List box labels with optional filtering.

        Args:
            frame_index: Filter by frame index
            label_source: Filter by label source ('user' or 'model')
            limit: Maximum number of labels to return
        """
        conditions: list[str] = []
        params: list[int | str] = []

        if frame_index is not None:
            conditions.append("frame_index = ?")
            params.append(frame_index)
        if label_source is not None:
            conditions.append("label_source = ?")
            params.append(label_source.value)

        query = "SELECT * FROM full_frame_box_labels"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY frame_index, box_index"

        if limit:
            query += f" LIMIT {limit}"

        cursor = self.conn.execute(query, params)
        rows = cursor.fetchall()
        return [FrameBoxLabel.from_row(_row_to_box_label_row(row)) for row in rows]

    def get_box_label(self, label_id: int) -> FrameBoxLabel | None:
        """Get a single box label by ID."""
        cursor = self.conn.execute(
            "SELECT * FROM full_frame_box_labels WHERE id = ?", (label_id,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return FrameBoxLabel.from_row(_row_to_box_label_row(row))

    def get_box_label_by_position(
        self, frame_index: int, box_index: int, label_source: LabelSource
    ) -> FrameBoxLabel | None:
        """Get box label by frame, box, and source."""
        cursor = self.conn.execute(
            """
            SELECT * FROM full_frame_box_labels
            WHERE frame_index = ? AND box_index = ? AND label_source = ?
            """,
            (frame_index, box_index, label_source.value),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return FrameBoxLabel.from_row(_row_to_box_label_row(row))

    def create_box_label(self, input: BoxLabelCreate) -> FrameBoxLabel:
        """
        Create or update a box label.

        Uses INSERT OR REPLACE to handle the unique constraint on
        (frame_index, box_index, label_source).
        """
        self.conn.execute(
            """
            INSERT INTO full_frame_box_labels (frame_index, box_index, label, label_source)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(frame_index, box_index, label_source)
            DO UPDATE SET label = excluded.label, created_at = datetime('now')
            """,
            (
                input.frameIndex,
                input.boxIndex,
                input.label.value,
                input.labelSource.value,
            ),
        )
        self.conn.commit()

        # Get the created/updated label
        return self.get_box_label_by_position(
            input.frameIndex, input.boxIndex, input.labelSource
        )  # type: ignore

    def create_box_labels_batch(self, labels: list[BoxLabelCreate]) -> list[FrameBoxLabel]:
        """Create multiple box labels in a single transaction."""
        created: list[FrameBoxLabel] = []

        for label_input in labels:
            self.conn.execute(
                """
                INSERT INTO full_frame_box_labels (frame_index, box_index, label, label_source)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(frame_index, box_index, label_source)
                DO UPDATE SET label = excluded.label, created_at = datetime('now')
                """,
                (
                    label_input.frameIndex,
                    label_input.boxIndex,
                    label_input.label.value,
                    label_input.labelSource.value,
                ),
            )

        self.conn.commit()

        # Fetch all created/updated labels
        for label_input in labels:
            label = self.get_box_label_by_position(
                label_input.frameIndex, label_input.boxIndex, label_input.labelSource
            )
            if label:
                created.append(label)

        return created

    def delete_box_label(self, label_id: int) -> bool:
        """Delete a box label by ID."""
        cursor = self.conn.execute(
            "DELETE FROM full_frame_box_labels WHERE id = ?", (label_id,)
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def delete_box_labels_by_source(self, label_source: LabelSource) -> int:
        """Delete all box labels from a specific source. Returns count deleted."""
        cursor = self.conn.execute(
            "DELETE FROM full_frame_box_labels WHERE label_source = ?",
            (label_source.value,),
        )
        self.conn.commit()
        return cursor.rowcount

    def delete_box_labels_for_frame(self, frame_index: int) -> int:
        """Delete all box labels for a frame. Returns count deleted."""
        cursor = self.conn.execute(
            "DELETE FROM full_frame_box_labels WHERE frame_index = ?", (frame_index,)
        )
        self.conn.commit()
        return cursor.rowcount

    # =========================================================================
    # Video Preferences Operations
    # =========================================================================

    def get_preferences(self) -> VideoPreferences:
        """Get video preferences (creates default if not exists)."""
        cursor = self.conn.execute("SELECT * FROM video_preferences WHERE id = 1")
        row = cursor.fetchone()

        if row is None:
            # Create default preferences
            self.conn.execute(
                "INSERT INTO video_preferences (id, layout_approved) VALUES (1, 0)"
            )
            self.conn.commit()
            return VideoPreferences(layoutApproved=False)

        return VideoPreferences.from_row(_row_to_preferences_row(row))

    def update_preferences(self, input: VideoPreferencesUpdate) -> VideoPreferences:
        """Update video preferences."""
        self.conn.execute(
            "UPDATE video_preferences SET layout_approved = ? WHERE id = 1",
            (1 if input.layoutApproved else 0,),
        )
        self.conn.commit()
        return self.get_preferences()
