"""Database operations for full_frames pipeline.

Writes OCR results directly to the full_frame_ocr table in the video's fullOCR.db.
Writes frame images to full_frames table for blob storage.
"""

import sqlite3
from collections.abc import Callable
from pathlib import Path

from ocr import ensure_ocr_table, write_ocr_result_to_database
from PIL import Image


def get_database_path(output_dir: Path) -> Path:
    """Get fullOCR.db path from full_frames output directory.

    Args:
        output_dir: Path to full_frames output directory

    Returns:
        Path to fullOCR.db file
    """
    # Go up one level from full_frames to video directory
    video_dir = output_dir.parent
    return video_dir / "fullOCR.db"


# Database operations are in the ocr package
# Use ensure_ocr_table and write_ocr_result_to_database from ocr


def load_ocr_annotations_from_database(db_path: Path) -> list[dict]:
    """Load OCR annotations from full_frame_ocr table.

    Returns data in same format as caption_models.load_ocr_annotations for compatibility
    with analysis functions.

    Args:
        db_path: Path to fullOCR.db file

    Returns:
        List of OCR annotation dictionaries, one per frame

    Format:
        [
            {
                "image_path": "full_frames/frame_0000000100.jpg",
                "annotations": [
                    ["你", 0.95, [0.1, 0.8, 0.02, 0.03]],
                    ["好", 0.98, [0.12, 0.8, 0.02, 0.03]],
                    ...
                ]
            },
            ...
        ]
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        # Get all unique frame indices
        cursor.execute("SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index")
        frame_indices = [row[0] for row in cursor.fetchall()]

        annotations = []
        for frame_index in frame_indices:
            # Get all boxes for this frame
            cursor.execute(
                """
                SELECT box_index, text, confidence, x, y, width, height
                FROM full_frame_ocr
                WHERE frame_index = ?
                ORDER BY box_index
            """,
                (frame_index,),
            )

            boxes = []
            for row in cursor.fetchall():
                box_index, text, confidence, x, y, width, height = row
                boxes.append([text, confidence, [x, y, width, height]])

            # Create annotation entry in same format as JSONL
            annotations.append({"image_path": f"full_frames/frame_{frame_index:010d}.jpg", "annotations": boxes})

        return annotations

    finally:
        conn.close()


def write_frames_to_database(
    frames_dir: Path,
    db_path: Path,
    progress_callback: Callable[[int, int], None] | None = None,
    delete_after_write: bool = True,
) -> int:
    """Write all frame images from directory to database.

    Reads JPEG frames from filesystem, stores in full_frames table, and optionally
    deletes the filesystem frames.

    Args:
        frames_dir: Directory containing frame images (frame_*.jpg)
        db_path: Path to fullOCR.db file
        progress_callback: Optional callback (current, total) -> None
        delete_after_write: If True, delete frame files after writing to DB

    Returns:
        Number of frames written to database
    """
    from frames_db import write_frames_batch

    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        return 0

    # Clear existing frames from database to prevent UNIQUE constraint errors
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DELETE FROM full_frames")
        conn.commit()
    finally:
        conn.close()

    # Prepare frame data
    frames = []
    for frame_file in frame_files:
        # Extract frame index from filename
        frame_index = int(frame_file.stem.split("_")[1])

        # Read image data and get dimensions
        image_data = frame_file.read_bytes()
        img = Image.open(frame_file)
        width, height = img.size

        frames.append((frame_index, image_data, width, height))

    # Write to database in batch
    count = write_frames_batch(
        db_path=db_path,
        frames=frames,
        table="full_frames",
        progress_callback=progress_callback,
    )

    # Delete filesystem frames if requested
    if delete_after_write:
        for frame_file in frame_files:
            frame_file.unlink()

    return count


