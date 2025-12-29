"""Database operations for full_frames pipeline.

Writes OCR results directly to the full_frame_ocr table in the video's annotations.db.
Writes frame images to full_frames table for blob storage.
"""

import json
import sqlite3
from pathlib import Path
from typing import Optional

from PIL import Image


def get_database_path(output_dir: Path) -> Path:
    """Get annotations.db path from full_frames output directory.

    Args:
        output_dir: Path to full_frames output directory
                   (e.g., local/data/show_name/video_id/full_frames)

    Returns:
        Path to annotations.db file

    Example:
        >>> get_database_path(Path("local/data/show_name/video_id/full_frames"))
        Path("local/data/show_name/video_id/annotations.db")
    """
    # Go up one level from full_frames to video directory
    video_dir = output_dir.parent
    return video_dir / "annotations.db"


def ensure_full_frame_ocr_table(db_path: Path) -> None:
    """Ensure full_frame_ocr table exists in database.

    Creates the table if it doesn't exist.

    Args:
        db_path: Path to annotations.db file
    """
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS full_frame_ocr (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                confidence REAL NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(frame_index, box_index)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_full_frame_ocr_frame
            ON full_frame_ocr(frame_index)
        """)
        conn.commit()
    finally:
        conn.close()


def write_ocr_to_database(
    ocr_result: dict,
    db_path: Path,
    progress_callback: Optional[callable] = None,
) -> int:
    """Write OCR result to full_frame_ocr table.

    Args:
        ocr_result: OCR result dictionary from process_frame_ocr_with_retry
        db_path: Path to annotations.db file
        progress_callback: Optional callback for progress updates

    Returns:
        Number of boxes inserted

    OCR Result Format:
        {
            "image_path": "full_frames/frame_0000000100.jpg",
            "framework": "livetext",
            "language_preference": "zh-Hans",
            "annotations": [
                ["你", 0.95, [0.1, 0.8, 0.02, 0.03]],
                ["好", 0.98, [0.12, 0.8, 0.02, 0.03]],
                ...
            ]
        }
    """
    # Extract frame index from image path
    image_path = Path(ocr_result["image_path"])
    frame_name = image_path.name  # e.g., "frame_0000000100.jpg"
    frame_index = int(frame_name.split("_")[1].split(".")[0])  # Extract 100 from "frame_0000000100.jpg"

    annotations = ocr_result.get("annotations", [])
    if not annotations:
        return 0

    # Connect and insert boxes
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        inserted = 0

        for box_index, annotation in enumerate(annotations):
            text, confidence, bbox = annotation
            x, y, width, height = bbox

            # Insert with ON CONFLICT DO NOTHING to handle re-runs
            cursor.execute("""
                INSERT INTO full_frame_ocr (frame_index, box_index, text, confidence, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(frame_index, box_index) DO NOTHING
            """, (frame_index, box_index, text, confidence, x, y, width, height))

            if cursor.rowcount > 0:
                inserted += 1

        conn.commit()
        return inserted

    finally:
        conn.close()


def load_ocr_annotations_from_database(db_path: Path) -> list[dict]:
    """Load OCR annotations from full_frame_ocr table.

    Returns data in same format as caption_models.load_ocr_annotations for compatibility
    with analysis functions.

    Args:
        db_path: Path to annotations.db file

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
            cursor.execute("""
                SELECT box_index, text, confidence, x, y, width, height
                FROM full_frame_ocr
                WHERE frame_index = ?
                ORDER BY box_index
            """, (frame_index,))

            boxes = []
            for row in cursor.fetchall():
                box_index, text, confidence, x, y, width, height = row
                boxes.append([text, confidence, [x, y, width, height]])

            # Create annotation entry in same format as JSONL
            annotations.append({
                "image_path": f"full_frames/frame_{frame_index:010d}.jpg",
                "annotations": boxes
            })

        return annotations

    finally:
        conn.close()


def write_frames_to_database(
    frames_dir: Path,
    db_path: Path,
    progress_callback: Optional[callable] = None,
    delete_after_write: bool = True,
) -> int:
    """Write all frame images from directory to database.

    Reads JPEG frames from filesystem, stores in full_frames table, and optionally
    deletes the filesystem frames.

    Args:
        frames_dir: Directory containing frame images (frame_*.jpg)
        db_path: Path to annotations.db file
        progress_callback: Optional callback (current, total) -> None
        delete_after_write: If True, delete frame files after writing to DB

    Returns:
        Number of frames written to database

    Example:
        >>> write_frames_to_database(
        ...     frames_dir=Path("local/data/show/video/full_frames"),
        ...     db_path=Path("local/data/show/video/annotations.db"),
        ...     delete_after_write=True
        ... )
        42
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


def process_frames_to_database(
    frames_dir: Path,
    db_path: Path,
    language: str = "zh-Hans",
    progress_callback: Optional[callable] = None,
    max_workers: int = 1,
) -> int:
    """Process all frames in a directory with OCR and write to database.

    This is a database-writing version of ocr_utils.process_frames_directory.
    Instead of writing to JSONL, writes directly to full_frame_ocr table.

    Frames are always kept after processing.

    Args:
        frames_dir: Directory containing frame images
        db_path: Path to annotations.db file
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        max_workers: Maximum concurrent OCR workers (default: 1 for macOS OCR)

    Returns:
        Total number of OCR boxes inserted into database
    """
    from concurrent.futures import ProcessPoolExecutor, as_completed
    from ocr_utils import process_frame_ocr_with_retry

    # Ensure table exists
    ensure_full_frame_ocr_table(db_path)

    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise FileNotFoundError(f"No frame images found in {frames_dir}")

    total = len(frame_files)
    total_boxes = 0

    # Process with worker pool
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Submit all frames to worker pool
        futures = {
            executor.submit(process_frame_ocr_with_retry, frame_path, language): frame_path
            for frame_path in frame_files
        }

        # Collect and write results as they complete
        completed_count = 0
        for future in as_completed(futures):
            frame_path = futures[future]
            try:
                ocr_result = future.result()

                # Write to database
                boxes_inserted = write_ocr_to_database(ocr_result, db_path)
                total_boxes += boxes_inserted

                completed_count += 1
                if progress_callback:
                    progress_callback(completed_count, total)

            except Exception as e:
                print(f"UNEXPECTED ERROR processing {frame_path.name}: {e}")

    return total_boxes
