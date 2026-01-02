"""Database operations for caption_text pipeline.

Interacts with annotations.db for caption text reading, comparison, and vetting.
"""

import sqlite3
from pathlib import Path
from typing import Any


def get_database_path(video_dir: Path) -> Path:
    """Get annotations.db path from video directory.

    Args:
        video_dir: Path to video directory (e.g., local/data/show_name/video_id/)

    Returns:
        Path to annotations.db file

    Example:
        >>> get_database_path(Path("local/data/show_name/video_id"))
        Path("local/data/show_name/video_id/annotations.db")
    """
    return video_dir / "annotations.db"


def get_layout_config(db_path: Path) -> dict[str, Any]:
    """Get video layout configuration.

    Args:
        db_path: Path to annotations.db

    Returns:
        Dictionary with layout config (anchor_type, anchor_position, box_height, etc.)
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            frame_width, frame_height,
            crop_left, crop_top, crop_right, crop_bottom,
            vertical_position, box_height,
            anchor_type, anchor_position
        FROM video_layout_config
        WHERE id = 1
    """)

    row = cursor.fetchone()
    conn.close()

    if not row:
        raise ValueError(f"No layout config found in {db_path}")

    return dict(row)


def get_captions_needing_text(db_path: Path, limit: int | None = None) -> list[dict[str, Any]]:
    """Get captions that need text annotation.

    Args:
        db_path: Path to annotations.db
        limit: Optional limit on number of results

    Returns:
        List of caption dictionaries with id, start_frame_index, end_frame_index, text, etc.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
        SELECT
            id, start_frame_index, end_frame_index,
            boundary_state, text, text_pending, text_status, text_ocr_combined
        FROM captions
        WHERE (text IS NULL OR text_pending = 1)
          AND boundary_state != 'gap'
        ORDER BY start_frame_index
    """

    if limit:
        query += f" LIMIT {limit}"

    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]




def update_caption_text(
    db_path: Path,
    caption_id: int,
    text: str,
    text_status: str | None = None,
    text_notes: str | None = None,
    clear_pending: bool = True,
) -> None:
    """Update caption text annotation.

    Args:
        db_path: Path to annotations.db
        caption_id: Caption ID to update
        text: Caption text (empty string = "no caption")
        text_status: Optional text status ('valid_caption', 'ocr_error', etc.)
        text_notes: Optional annotation notes
        clear_pending: If True, set text_pending = 0
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    updates = ["text = ?"]
    params: list[Any] = [text]

    if text_status is not None:
        updates.append("text_status = ?")
        params.append(text_status)

    if text_notes is not None:
        updates.append("text_notes = ?")
        params.append(text_notes)

    if clear_pending:
        updates.append("text_pending = 0")

    params.append(caption_id)

    cursor.execute(
        f"""
        UPDATE captions
        SET {", ".join(updates)}
        WHERE id = ?
    """,
        params,
    )

    conn.commit()
    conn.close()


def save_vlm_inference_result(
    db_path: Path,
    caption_id: int,
    vlm_text: str,
    source: str = "vlm_finetuned",
) -> None:
    """Save VLM inference result as caption text.

    Args:
        db_path: Path to annotations.db
        caption_id: Caption ID to update
        vlm_text: VLM-predicted text
        source: Source identifier for notes (e.g., 'vlm_finetuned', 'vlm_base')
    """
    update_caption_text(
        db_path=db_path,
        caption_id=caption_id,
        text=vlm_text,
        text_status="valid_caption",
        text_notes=f"Auto-generated from {source}",
        clear_pending=False,  # Keep pending for manual review
    )


def mark_text_as_validated(
    db_path: Path,
    caption_id: int,
    validation_source: str = "ocr_match",
) -> None:
    """Mark caption text as validated (e.g., OCR match).

    Args:
        db_path: Path to annotations.db
        caption_id: Caption ID to update
        validation_source: Source of validation ('ocr_match', 'manual_review', etc.)
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute(
        """
        UPDATE captions
        SET
            text_pending = 0,
            text_status = 'valid_caption',
            text_notes = ?
        WHERE id = ?
    """,
        (f"Validated: {validation_source}", caption_id),
    )

    conn.commit()
    conn.close()


def get_caption_by_frames(db_path: Path, start_frame: int, end_frame: int) -> dict[str, Any] | None:
    """Get caption by exact frame range.

    Args:
        db_path: Path to annotations.db
        start_frame: Start frame index
        end_frame: End frame index

    Returns:
        Caption dictionary or None if not found
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            id, start_frame_index, end_frame_index,
            boundary_state, text, text_pending, text_status,
            text_notes, text_ocr_combined
        FROM captions
        WHERE start_frame_index = ? AND end_frame_index = ?
    """,
        (start_frame, end_frame),
    )

    row = cursor.fetchone()
    conn.close()

    return dict(row) if row else None


def get_captions_with_text(db_path: Path, min_id: int = 0, limit: int | None = None) -> list[dict[str, Any]]:
    """Get captions that have text (for vetting/correction).

    Args:
        db_path: Path to annotations.db
        min_id: Minimum caption ID (for pagination)
        limit: Optional limit on number of results

    Returns:
        List of caption dictionaries with text
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
        SELECT
            id, start_frame_index, end_frame_index,
            text, text_status, text_notes
        FROM captions
        WHERE text IS NOT NULL
          AND text != ''
          AND id > ?
        ORDER BY id
    """

    params = [min_id]
    if limit:
        query += f" LIMIT {limit}"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]
