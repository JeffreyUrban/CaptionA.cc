"""Frame retrieval operations for reading frames from database."""

import sqlite3
from pathlib import Path

from frames_db.models import FrameData


def get_frame_from_db(
    db_path: Path,
    frame_index: int,
    table: str = "full_frames",
) -> FrameData | None:
    """Get single frame from database by index.

    Args:
        db_path: Path to SQLite database file
        frame_index: Frame index to retrieve
        table: Table name ("full_frames")

    Returns:
        FrameData object if found, None otherwise

    Raises:
        ValueError: If table is invalid

    Example:
        >>> frame = get_frame_from_db(
        ...     db_path=Path("captions.db"),
        ...     frame_index=100,
        ...     table="full_frames"
        ... )
        >>> if frame:
        ...     img = frame.to_pil_image()
        ...     img.show()
    """
    if table not in ("full_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames'")

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT frame_index, image_data, width, height, file_size, created_at
            FROM {table}
            WHERE frame_index = ?
            """,
            (frame_index,),
        )

        row = cursor.fetchone()
        if row is None:
            return None

        return FrameData(
            frame_index=row[0],
            image_data=row[1],
            width=row[2],
            height=row[3],
            file_size=row[4],
            created_at=row[5],
        )

    finally:
        conn.close()


def get_frames_range(
    db_path: Path,
    start_index: int,
    end_index: int,
    table: str = "full_frames",
) -> list[FrameData]:
    """Get frames within index range (inclusive).

    Args:
        db_path: Path to SQLite database file
        start_index: Start frame index (inclusive)
        end_index: End frame index (inclusive)
        table: Table name ("full_frames")

    Returns:
        List of FrameData objects sorted by frame_index

    Raises:
        ValueError: If table is invalid

    Example:
        >>> frames = get_frames_range(
        ...     db_path=Path("captions.db"),
        ...     start_index=0,
        ...     end_index=1000,
        ...     table="full_frames"
        ... )
        >>> for frame in frames:
        ...     print(f"Frame {frame.frame_index}: {frame.width}x{frame.height}")
    """
    if table not in ("full_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames'")

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT frame_index, image_data, width, height, file_size, created_at
            FROM {table}
            WHERE frame_index >= ? AND frame_index <= ?
            ORDER BY frame_index
            """,
            (start_index, end_index),
        )

        frames = []
        for row in cursor.fetchall():
            frames.append(
                FrameData(
                    frame_index=row[0],
                    image_data=row[1],
                    width=row[2],
                    height=row[3],
                    file_size=row[4],
                    created_at=row[5],
                )
            )

        return frames

    finally:
        conn.close()


def get_all_frame_indices(
    db_path: Path,
    table: str = "full_frames",
) -> list[int]:
    """Get all frame indices from table.

    Useful for discovering what frames are available without loading full data.

    Args:
        db_path: Path to SQLite database file
        table: Table name ("full_frames")

    Returns:
        List of frame indices sorted in ascending order

    Raises:
        ValueError: If table is invalid

    Example:
        >>> indices = get_all_frame_indices(
        ...     db_path=Path("captions.db"),
        ...     table="full_frames"
        ... )
        >>> print(f"Found {len(indices)} frames")
        >>> print(f"Range: {min(indices)} to {max(indices)}")
    """
    if table not in ("full_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames'")

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT frame_index
            FROM {table}
            ORDER BY frame_index
            """
        )

        return [row[0] for row in cursor.fetchall()]

    finally:
        conn.close()
