"""Frame storage operations for writing frames to database."""

import sqlite3
from collections.abc import Callable
from pathlib import Path


def write_frame_to_db(
    db_path: Path,
    frame_index: int,
    image_data: bytes,
    width: int,
    height: int,
    table: str = "full_frames",
    crop_bounds_version: int | None = None,
    crop_bounds: tuple[int, int, int, int] | None = None,
) -> None:
    """Write single frame to database.

    Args:
        db_path: Path to SQLite database file
        frame_index: Frame index in video
        image_data: JPEG-compressed image bytes
        width: Frame width in pixels
        height: Frame height in pixels
        table: Table name ("full_frames" or "cropped_frames")
        crop_bounds_version: Crop bounds version (for cropped_frames only)
        crop_bounds: Crop bounds as (left, top, right, bottom) in pixels (for cropped_frames only)

    Raises:
        sqlite3.IntegrityError: If frame_index already exists
        ValueError: If table is invalid or required parameters missing for cropped_frames

    Example:
        >>> jpeg_bytes = Path("frame_0000000000.jpg").read_bytes()
        >>> write_frame_to_db(
        ...     db_path=Path("annotations.db"),
        ...     frame_index=0,
        ...     image_data=jpeg_bytes,
        ...     width=1920,
        ...     height=1080,
        ...     table="full_frames"
        ... )
    """
    if table not in ("full_frames", "cropped_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames' or 'cropped_frames'")

    if table == "cropped_frames":
        if crop_bounds_version is None:
            raise ValueError("crop_bounds_version is required for cropped_frames table")
        if crop_bounds is None:
            raise ValueError("crop_bounds is required for cropped_frames table")

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        if table == "full_frames":
            cursor.execute(
                """
                INSERT INTO full_frames (frame_index, image_data, width, height, file_size)
                VALUES (?, ?, ?, ?, ?)
                """,
                (frame_index, image_data, width, height, len(image_data)),
            )
        else:  # cropped_frames
            crop_left, crop_top, crop_right, crop_bottom = crop_bounds
            cursor.execute(
                """
                INSERT INTO cropped_frames (
                    frame_index, image_data, width, height, file_size,
                    crop_left, crop_top, crop_right, crop_bottom, crop_bounds_version
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    frame_index,
                    image_data,
                    width,
                    height,
                    len(image_data),
                    crop_left,
                    crop_top,
                    crop_right,
                    crop_bottom,
                    crop_bounds_version,
                ),
            )

        conn.commit()
    finally:
        conn.close()


def write_frames_batch(
    db_path: Path,
    frames: list[tuple[int, bytes, int, int]],
    table: str = "full_frames",
    crop_bounds_version: int | None = None,
    crop_bounds: tuple[int, int, int, int] | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
) -> int:
    """Write multiple frames to database in a single transaction.

    This is more efficient than calling write_frame_to_db repeatedly.

    Args:
        db_path: Path to SQLite database file
        frames: List of (frame_index, image_data, width, height) tuples
        table: Table name ("full_frames" or "cropped_frames")
        crop_bounds_version: Crop bounds version (for cropped_frames only)
        crop_bounds: Crop bounds as (left, top, right, bottom) in pixels (for cropped_frames only)
        progress_callback: Optional callback function(current, total) for progress tracking

    Returns:
        Number of frames written

    Raises:
        ValueError: If table is invalid or required parameters missing for cropped_frames

    Example:
        >>> frames = []
        >>> for frame_file in sorted(Path("frames").glob("frame_*.jpg")):
        ...     frame_index = int(frame_file.stem.split('_')[1])
        ...     image_data = frame_file.read_bytes()
        ...     img = Image.open(frame_file)
        ...     frames.append((frame_index, image_data, img.width, img.height))
        >>>
        >>> count = write_frames_batch(
        ...     db_path=Path("annotations.db"),
        ...     frames=frames,
        ...     table="full_frames",
        ...     progress_callback=lambda cur, tot: print(f"{cur}/{tot}")
        ... )
        >>> print(f"Wrote {count} frames")
    """
    if table not in ("full_frames", "cropped_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames' or 'cropped_frames'")

    if table == "cropped_frames":
        if crop_bounds_version is None:
            raise ValueError("crop_bounds_version is required for cropped_frames table")
        if crop_bounds is None:
            raise ValueError("crop_bounds is required for cropped_frames table")

    if not frames:
        return 0

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        if table == "full_frames":
            for i, (frame_index, image_data, width, height) in enumerate(frames):
                cursor.execute(
                    """
                    INSERT INTO full_frames (frame_index, image_data, width, height, file_size)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (frame_index, image_data, width, height, len(image_data)),
                )

                if progress_callback:
                    progress_callback(i + 1, len(frames))

        else:  # cropped_frames
            # Delete existing frames for this crop_bounds_version to avoid UNIQUE constraint errors
            cursor.execute(
                """
                DELETE FROM cropped_frames
                WHERE crop_bounds_version = ?
                """,
                (crop_bounds_version,),
            )

            crop_left, crop_top, crop_right, crop_bottom = crop_bounds
            for i, (frame_index, image_data, width, height) in enumerate(frames):
                cursor.execute(
                    """
                    INSERT INTO cropped_frames (
                        frame_index, image_data, width, height, file_size,
                        crop_left, crop_top, crop_right, crop_bottom, crop_bounds_version
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        frame_index,
                        image_data,
                        width,
                        height,
                        len(image_data),
                        crop_left,
                        crop_top,
                        crop_right,
                        crop_bottom,
                        crop_bounds_version,
                    ),
                )

                if progress_callback:
                    progress_callback(i + 1, len(frames))

        conn.commit()
        return len(frames)

    finally:
        conn.close()
