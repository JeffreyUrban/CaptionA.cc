"""Database operations for full_frames pipeline.

Writes OCR results directly to the full_frame_ocr table in the video's captions.db.
Writes frame images to full_frames table for blob storage.
"""

import sqlite3
from collections.abc import Callable
from pathlib import Path

from ocr_utils import ensure_ocr_table, write_ocr_result_to_database
from PIL import Image


def get_database_path(output_dir: Path) -> Path:
    """Get captions.db path from full_frames output directory.

    Args:
        output_dir: Path to full_frames output directory
                   (e.g., local/data/show_name/video_id/full_frames)

    Returns:
        Path to captions.db file

    Example:
        >>> get_database_path(Path("local/data/show_name/video_id/full_frames"))
        Path("local/data/show_name/video_id/captions.db")
    """
    # Go up one level from full_frames to video directory
    video_dir = output_dir.parent
    return video_dir / "captions.db"


# These functions have been moved to ocr_utils package
# Use ensure_ocr_table and write_ocr_result_to_database from ocr_utils instead


def load_ocr_annotations_from_database(db_path: Path) -> list[dict]:
    """Load OCR annotations from full_frame_ocr table.

    Returns data in same format as caption_models.load_ocr_annotations for compatibility
    with analysis functions.

    Args:
        db_path: Path to captions.db file

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
        db_path: Path to captions.db file
        progress_callback: Optional callback (current, total) -> None
        delete_after_write: If True, delete frame files after writing to DB

    Returns:
        Number of frames written to database

    Example:
        >>> write_frames_to_database(
        ...     frames_dir=Path("local/data/show/video/full_frames"),
        ...     db_path=Path("local/data/show/video/captions.db"),
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
    progress_callback: Callable[[int, int], None] | None = None,
    max_workers: int = 1,
) -> int:
    """Process all frames in a directory with OCR and write to database.

    This is a database-writing version of ocr_utils.process_frames_directory.
    Instead of writing to JSONL, writes directly to full_frame_ocr table.

    Frames are always kept after processing.

    Args:
        frames_dir: Directory containing frame images
        db_path: Path to captions.db file
        language: OCR language preference
        progress_callback: Optional callback (current, total) -> None
        max_workers: Maximum concurrent OCR workers (default: 1 for macOS OCR)

    Returns:
        Total number of OCR boxes inserted into database
    """
    from concurrent.futures import ProcessPoolExecutor, as_completed

    from ocr_utils import process_frame_ocr_with_retry

    # Ensure table exists using shared function
    ensure_ocr_table(db_path, table_name="full_frame_ocr")

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

                # Write to database using shared function
                boxes_inserted = write_ocr_result_to_database(
                    ocr_result=ocr_result,
                    db_path=db_path,
                    table_name="full_frame_ocr",
                )
                total_boxes += boxes_inserted

                completed_count += 1
                if progress_callback:
                    progress_callback(completed_count, total)

            except Exception as e:
                print(f"UNEXPECTED ERROR processing {frame_path.name}: {e}")

    return total_boxes
