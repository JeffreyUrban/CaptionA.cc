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
) -> None:
    """Write single frame to database.

    Args:
        db_path: Path to SQLite database file
        frame_index: Frame index in video
        image_data: JPEG-compressed image bytes
        width: Frame width in pixels
        height: Frame height in pixels
        table: Table name ("full_frames")

    Raises:
        sqlite3.IntegrityError: If frame_index already exists
        ValueError: If table is invalid

    Example:
        >>> jpeg_bytes = Path("frame_0000000000.jpg").read_bytes()
        >>> write_frame_to_db(
        ...     db_path=Path("captions.db"),
        ...     frame_index=0,
        ...     image_data=jpeg_bytes,
        ...     width=1920,
        ...     height=1080,
        ...     table="full_frames"
        ... )
    """
    if table not in ("full_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames'")

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

        conn.commit()
    finally:
        conn.close()


def write_frames_batch(
    db_path: Path,
    frames: list[tuple[int, bytes, int, int]],
    table: str = "full_frames",
    progress_callback: Callable[[int, int], None] | None = None,
) -> int:
    """Write multiple frames to database in a single transaction.

    This is more efficient than calling write_frame_to_db repeatedly.

    Args:
        db_path: Path to SQLite database file
        frames: List of (frame_index, image_data, width, height) tuples
        table: Table name ("full_frames")
        progress_callback: Optional callback function(current, total) for progress tracking

    Returns:
        Number of frames written

    Raises:
        ValueError: If table is invalid

    Example:
        >>> frames = []
        >>> for frame_file in sorted(Path("frames").glob("frame_*.jpg")):
        ...     frame_index = int(frame_file.stem.split('_')[1])
        ...     image_data = frame_file.read_bytes()
        ...     img = Image.open(frame_file)
        ...     frames.append((frame_index, image_data, img.width, img.height))
        >>>
        >>> count = write_frames_batch(
        ...     db_path=Path("captions.db"),
        ...     frames=frames,
        ...     table="full_frames",
        ...     progress_callback=lambda cur, tot: print(f"{cur}/{tot}")
        ... )
        >>> print(f"Wrote {count} frames")
    """
    if table not in ("full_frames"):
        raise ValueError(f"Invalid table: {table}. Must be 'full_frames'")

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

        conn.commit()
        return len(frames)

    finally:
        conn.close()


# VP9 Encoding Status Functions


def init_vp9_encoding_status(
    db_path: Path,
    video_id: str,
    frame_type: str,
    modulo_levels: list[int],
    total_frames: int = 0,
) -> None:
    """Initialize VP9 encoding status for a video.

    Args:
        db_path: Path to SQLite database file
        video_id: Video UUID
        frame_type: "full"
        modulo_levels: List of modulo levels (e.g., [16, 4, 1])
        total_frames: Total number of frames to encode
    """
    import json

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        # Insert or replace (in case re-encoding)
        cursor.execute(
            """
            INSERT OR REPLACE INTO vp9_encoding_status (
                video_id,
                frame_type,
                status,
                modulo_levels,
                total_frames,
                chunks_encoded,
                chunks_uploaded,
                wasabi_available
            ) VALUES (?, ?, 'pending', ?, ?, 0, 0, 0)
            """,
            (video_id, frame_type, json.dumps(modulo_levels), total_frames),
        )

        conn.commit()
    finally:
        conn.close()


def update_vp9_encoding_status(
    db_path: Path,
    video_id: str,
    frame_type: str,
    status: str | None = None,
    chunks_encoded: int | None = None,
    chunks_uploaded: int | None = None,
    wasabi_available: bool | None = None,
    error_message: str | None = None,
) -> None:
    """Update VP9 encoding status.

    Args:
        db_path: Path to SQLite database file
        video_id: Video UUID
        frame_type: "full"
        status: New status (optional)
        chunks_encoded: Number of chunks encoded (optional)
        chunks_uploaded: Number of chunks uploaded (optional)
        wasabi_available: Whether chunks are available in Wasabi (optional)
        error_message: Error message if failed (optional)
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        # Build dynamic UPDATE statement
        updates = []
        params = []

        if status is not None:
            updates.append("status = ?")
            params.append(status)

            # Update timestamps based on status
            if status == "encoding":
                updates.append("encoding_started_at = datetime('now')")
            elif status in ("completed", "failed"):
                updates.append("encoding_completed_at = datetime('now')")

        if chunks_encoded is not None:
            updates.append("chunks_encoded = ?")
            params.append(chunks_encoded)

        if chunks_uploaded is not None:
            updates.append("chunks_uploaded = ?")
            params.append(chunks_uploaded)

        if wasabi_available is not None:
            updates.append("wasabi_available = ?")
            params.append(1 if wasabi_available else 0)

        if error_message is not None:
            updates.append("error_message = ?")
            params.append(error_message)

        # Add WHERE clause params
        params.extend([video_id, frame_type])

        if updates:
            query = f"""
                UPDATE vp9_encoding_status
                SET {", ".join(updates)}
                WHERE video_id = ? AND frame_type = ?
            """
            cursor.execute(query, params)

        conn.commit()
    finally:
        conn.close()


def get_vp9_encoding_status(
    db_path: Path,
    video_id: str,
    frame_type: str,
) -> dict | None:
    """Get VP9 encoding status for a video.

    Args:
        db_path: Path to SQLite database file
        video_id: Video UUID
        frame_type: "full"

    Returns:
        Dict with status fields, or None if not found
    """
    import json

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                status,
                chunks_encoded,
                chunks_uploaded,
                total_frames,
                wasabi_available,
                modulo_levels,
                error_message,
                encoding_started_at,
                encoding_completed_at
            FROM vp9_encoding_status
            WHERE video_id = ? AND frame_type = ?
            """,
            (video_id, frame_type),
        )

        row = cursor.fetchone()

        if row is None:
            return None

        return {
            "status": row[0],
            "chunks_encoded": row[1],
            "chunks_uploaded": row[2],
            "total_frames": row[3],
            "wasabi_available": bool(row[4]),
            "modulo_levels": json.loads(row[5]) if row[5] else [],
            "error_message": row[6],
            "encoding_started_at": row[7],
            "encoding_completed_at": row[8],
        }

    finally:
        conn.close()
