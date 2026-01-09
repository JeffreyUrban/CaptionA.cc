"""Automatic font example image generation from confirmed captions."""

import sqlite3
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from .database import get_database_path


def find_longest_confirmed_caption(db_path: Path) -> dict | None:
    """Find the confirmed caption with the longest text.

    Args:
        db_path: Path to captions.db

    Returns:
        Dictionary with caption info or None if no confirmed captions
    """
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                id, start_frame_index, end_frame_index,
                text, LENGTH(text) as text_length
            FROM captions
            WHERE text IS NOT NULL
              AND text != ''
              AND boundary_state = 'confirmed'
            ORDER BY text_length DESC
            LIMIT 1
        """)

        row = cursor.fetchone()
        conn.close()

        return dict(row) if row else None

    except sqlite3.OperationalError:
        return None


def load_frames_from_db(db_path: Path, start_frame: int, end_frame: int) -> list[Image.Image]:
    """Load all cropped frames in a range from database.

    Args:
        db_path: Path to captions.db
        start_frame: Start frame index (inclusive)
        end_frame: End frame index (inclusive)

    Returns:
        List of PIL Images
    """
    from frames_db import get_frame_from_db

    frames = []

    # Load frames at ~10Hz sampling (every frame in cropped_frames)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT frame_index
        FROM cropped_frames
        WHERE frame_index >= ? AND frame_index <= ?
        ORDER BY frame_index
    """,
        (start_frame, end_frame),
    )

    frame_indices = [row[0] for row in cursor.fetchall()]
    conn.close()

    for frame_index in frame_indices:
        frame_data = get_frame_from_db(db_path, frame_index, table="cropped_frames")
        if frame_data:
            frames.append(Image.open(BytesIO(frame_data.image_data)))

    return frames


def average_frames(frames: list[Image.Image]) -> Image.Image:
    """Average multiple frames to create a cleaner reference image.

    Uses median averaging to reduce noise and transient artifacts.

    Args:
        frames: List of PIL Images (all same size)

    Returns:
        Averaged PIL Image
    """
    if not frames:
        raise ValueError("No frames to average")

    if len(frames) == 1:
        return frames[0]

    # Convert to numpy arrays
    arrays = [np.array(frame) for frame in frames]

    # Stack and take median (better than mean for removing outliers)
    stacked = np.stack(arrays, axis=0)
    averaged = np.median(stacked, axis=0).astype(np.uint8)

    return Image.fromarray(averaged)


def generate_font_example_image(
    video_dir: Path,
    db_path: Path,
    force: bool = False,
) -> tuple[Path, dict] | None:
    """Generate font example image for a video.

    Finds the confirmed caption with the longest text and averages
    all frames in that range to create a clean reference image.

    Args:
        video_dir: Video directory path
        db_path: Path to captions.db
        force: If True, regenerate even if font example already exists

    Returns:
        Tuple of (font_example_path, metadata) or None if no confirmed captions
        Metadata includes: caption_id, start_frame, end_frame, text, num_frames
    """
    # Check if font example already exists
    existing = list(video_dir.glob("font_example_image*.jpg"))
    if existing and not force:
        # Extract frame range from filename
        filename = existing[0].stem
        parts = filename.split("_")
        if len(parts) >= 5:  # font_example_image_frame_START_END
            metadata = {
                "start_frame": int(parts[3]),
                "end_frame": int(parts[4]),
            }
            return existing[0], metadata

    # Find longest confirmed caption
    caption = find_longest_confirmed_caption(db_path)
    if not caption:
        return None

    start_frame = caption["start_frame_index"]
    end_frame = caption["end_frame_index"]

    # Load all frames in range
    frames = load_frames_from_db(db_path, start_frame, end_frame)
    if not frames:
        print(f"Warning: No frames found for caption {caption['id']} in {video_dir}")
        return None

    # Average frames
    averaged_image = average_frames(frames)

    # Save font example image
    font_example_path = video_dir / f"font_example_image_frame_{start_frame}_{end_frame}.jpg"
    averaged_image.save(font_example_path, quality=95)

    metadata = {
        "caption_id": caption["id"],
        "start_frame": start_frame,
        "end_frame": end_frame,
        "text": caption["text"],
        "num_frames": len(frames),
    }

    return font_example_path, metadata


def generate_font_examples_for_all_videos(
    data_root: Path,
    force: bool = False,
) -> dict[Path, dict]:
    """Generate font example images for all videos with confirmed captions.

    Args:
        data_root: Root data directory
        force: If True, regenerate even if font examples exist

    Returns:
        Dictionary mapping video_dir -> metadata
    """
    from tqdm import tqdm

    from .training_data import find_all_video_dirs

    video_dirs = find_all_video_dirs(data_root)
    results = {}

    for video_dir in tqdm(video_dirs, desc="Generating font examples"):
        db_path = get_database_path(video_dir)

        result = generate_font_example_image(video_dir, db_path, force=force)
        if result:
            font_path, metadata = result
            results[video_dir] = metadata
            text_len = len(metadata["text"])
            print(f"Generated: {font_path.name} ({metadata['num_frames']} frames, text length: {text_len})")

    return results
