"""Database operations for OCR results.

Provides generic functions for writing OCR results to annotations.db tables.
Supports both full_frame_ocr and cropped_frame_ocr table schemas.
"""

import sqlite3
from pathlib import Path
from typing import Optional


def ensure_ocr_table(db_path: Path, table_name: str, include_crop_version: bool = False) -> None:
    """Ensure OCR table exists in database with normalized schema.

    Creates a normalized table schema with one row per OCR box.

    Args:
        db_path: Path to annotations.db file
        table_name: Table name ('full_frame_ocr' or 'cropped_frame_ocr')
        include_crop_version: If True, add crop_bounds_version column (for cropped_frame_ocr)
    """
    conn = sqlite3.connect(db_path)
    try:
        # Base schema: one row per box
        if include_crop_version:
            unique_constraint = "UNIQUE(frame_index, box_index, crop_bounds_version)"
            crop_version_col = "crop_bounds_version INTEGER NOT NULL,"
        else:
            unique_constraint = "UNIQUE(frame_index, box_index)"
            crop_version_col = ""

        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                confidence REAL NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                {crop_version_col}
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                {unique_constraint}
            )
        """)

        # Create index on frame_index for fast lookups
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{table_name}_frame
            ON {table_name}(frame_index)
        """)

        # Create index on crop_bounds_version if applicable
        if include_crop_version:
            conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_{table_name}_crop_version
                ON {table_name}(crop_bounds_version)
            """)

        conn.commit()
    finally:
        conn.close()


def write_ocr_result_to_database(
    ocr_result: dict,
    db_path: Path,
    table_name: str,
    crop_bounds_version: Optional[int] = None,
) -> int:
    """Write OCR result to database table.

    Args:
        ocr_result: OCR result dictionary from process_frame_ocr_with_retry
        db_path: Path to annotations.db file
        table_name: Table name ('full_frame_ocr' or 'cropped_frame_ocr')
        crop_bounds_version: Crop bounds version (required for cropped_frame_ocr)

    Returns:
        Number of boxes inserted

    OCR Result Format:
        {
            "image_path": "frames/frame_0000000100.jpg",
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
    frame_index = int(frame_name.split("_")[1].split(".")[0])

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

            # Build INSERT statement based on table type
            if crop_bounds_version is not None:
                # cropped_frame_ocr table
                cursor.execute(
                    f"""
                    INSERT INTO {table_name}
                    (frame_index, box_index, text, confidence, x, y, width, height, crop_bounds_version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(frame_index, box_index, crop_bounds_version) DO NOTHING
                """,
                    (frame_index, box_index, text, confidence, x, y, width, height, crop_bounds_version),
                )
            else:
                # full_frame_ocr table
                cursor.execute(
                    f"""
                    INSERT INTO {table_name}
                    (frame_index, box_index, text, confidence, x, y, width, height)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(frame_index, box_index) DO NOTHING
                """,
                    (frame_index, box_index, text, confidence, x, y, width, height),
                )

            if cursor.rowcount > 0:
                inserted += 1

        conn.commit()
        return inserted

    finally:
        conn.close()


def load_ocr_for_frame(
    db_path: Path,
    frame_index: int,
    table_name: str,
    crop_bounds_version: Optional[int] = None,
) -> list[tuple[str, float, list[float]]]:
    """Load OCR annotations for a specific frame.

    Args:
        db_path: Path to annotations.db file
        frame_index: Frame index to load
        table_name: Table name ('full_frame_ocr' or 'cropped_frame_ocr')
        crop_bounds_version: Crop bounds version (for cropped_frame_ocr)

    Returns:
        List of OCR annotations: [[text, confidence, [x, y, width, height]], ...]
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        # Build query based on table type
        if crop_bounds_version is not None:
            cursor.execute(
                f"""
                SELECT text, confidence, x, y, width, height
                FROM {table_name}
                WHERE frame_index = ? AND crop_bounds_version = ?
                ORDER BY box_index
            """,
                (frame_index, crop_bounds_version),
            )
        else:
            cursor.execute(
                f"""
                SELECT text, confidence, x, y, width, height
                FROM {table_name}
                WHERE frame_index = ?
                ORDER BY box_index
            """,
                (frame_index,),
            )

        annotations = []
        for row in cursor.fetchall():
            text, confidence, x, y, width, height = row
            annotations.append([text, confidence, [x, y, width, height]])

        return annotations

    finally:
        conn.close()


def load_ocr_for_frame_range(
    db_path: Path,
    start_frame: int,
    end_frame: int,
    table_name: str,
    crop_bounds_version: Optional[int] = None,
) -> list[dict]:
    """Load OCR annotations for a range of frames.

    Args:
        db_path: Path to annotations.db file
        start_frame: Start frame index (inclusive)
        end_frame: End frame index (inclusive)
        table_name: Table name ('full_frame_ocr' or 'cropped_frame_ocr')
        crop_bounds_version: Crop bounds version (for cropped_frame_ocr)

    Returns:
        List of dictionaries with frame_index and ocr_annotations:
        [
            {
                "frame_index": 100,
                "ocr_annotations": [["你", 0.95, [0.1, 0.8, 0.02, 0.03]], ...]
            },
            ...
        ]
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        # Get all frames in range
        if crop_bounds_version is not None:
            cursor.execute(
                f"""
                SELECT DISTINCT frame_index
                FROM {table_name}
                WHERE frame_index >= ? AND frame_index <= ? AND crop_bounds_version = ?
                ORDER BY frame_index
            """,
                (start_frame, end_frame, crop_bounds_version),
            )
        else:
            cursor.execute(
                f"""
                SELECT DISTINCT frame_index
                FROM {table_name}
                WHERE frame_index >= ? AND frame_index <= ?
                ORDER BY frame_index
            """,
                (start_frame, end_frame),
            )

        frame_indices = [row[0] for row in cursor.fetchall()]

        results = []
        for frame_index in frame_indices:
            # Get all boxes for this frame
            if crop_bounds_version is not None:
                cursor.execute(
                    f"""
                    SELECT text, confidence, x, y, width, height
                    FROM {table_name}
                    WHERE frame_index = ? AND crop_bounds_version = ?
                    ORDER BY box_index
                """,
                    (frame_index, crop_bounds_version),
                )
            else:
                cursor.execute(
                    f"""
                    SELECT text, confidence, x, y, width, height
                    FROM {table_name}
                    WHERE frame_index = ?
                    ORDER BY box_index
                """,
                    (frame_index,),
                )

            annotations = []
            for row in cursor.fetchall():
                text, confidence, x, y, width, height = row
                annotations.append([text, confidence, [x, y, width, height]])

            results.append({"frame_index": frame_index, "ocr_annotations": annotations})

        return results

    finally:
        conn.close()
