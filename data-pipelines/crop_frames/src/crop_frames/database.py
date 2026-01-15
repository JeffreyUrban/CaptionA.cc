"""Database operations for crop_frames pipeline.

Writes cropped frame images to the cropped_frames table in captions.db.
"""

from collections.abc import Callable
from pathlib import Path

from PIL import Image


def get_database_path(output_dir: Path) -> Path:
    """Get captions.db path from crop_frames output directory.

    Args:
        output_dir: Path to crop_frames output directory
                   (e.g., local/data/show_name/video_id/crop_frames)

    Returns:
        Path to captions.db file

    Example:
        >>> get_database_path(Path("local/data/show_name/video_id/crop_frames"))
        Path("local/data/show_name/video_id/captions.db")
    """
    # Go up one level from crop_frames to video directory
    video_dir = output_dir.parent
    return video_dir / "captions.db"


def write_frames_to_database(
    frames_dir: Path,
    db_path: Path,
    crop_bounds: tuple[int, int, int, int],
    crop_bounds_version: int = 1,
    progress_callback: Callable[[int, int], None] | None = None,
    delete_after_write: bool = True,
) -> int:
    """Write all cropped frame images from directory to database.

    Reads JPEG frames from filesystem, stores in cropped_frames table, and optionally
    deletes the filesystem frames.

    Args:
        frames_dir: Directory containing frame images (frame_*.jpg)
        db_path: Path to captions.db file
        crop_bounds: Crop bounds as (left, top, right, bottom) in pixels
        crop_bounds_version: Crop bounds version number (from video_layout_config)
        progress_callback: Optional callback (current, total) -> None
        delete_after_write: If True, delete frame files after writing to DB

    Returns:
        Number of frames written to database

    Example:
        >>> write_frames_to_database(
        ...     frames_dir=Path("local/data/show/video/crop_frames"),
        ...     db_path=Path("local/data/show/video/captions.db"),
        ...     crop_bounds=(100, 200, 700, 250),
        ...     crop_bounds_version=1,
        ...     delete_after_write=True
        ... )
        420
    """
    from frames_db import write_frames_batch

    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        return 0

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
        table="cropped_frames",
        crop_bounds_version=crop_bounds_version,
        crop_bounds=crop_bounds,
        progress_callback=progress_callback,
    )

    # Delete filesystem frames if requested
    if delete_after_write:
        for frame_file in frame_files:
            frame_file.unlink()

    return count
