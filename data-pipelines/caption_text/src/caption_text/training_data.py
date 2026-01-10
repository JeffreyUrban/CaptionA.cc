"""Training data collection from confirmed text annotations across all videos."""

# TODO: The database details in this file are out of date.

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image
from tqdm import tqdm

from .database import get_database_path, get_layout_config


@dataclass
class TrainingSample:
    """A single training sample for caption text generation.

    Attributes:
        video_id: Video identifier (video path)
        caption_id: Caption annotation ID
        start_frame: Start frame index
        end_frame: End frame index
        main_image: Cropped caption frame
        font_image: Font example reference image
        ocr_annotations: List of [[char, conf, [x1, y1, x2, y2]], ...]
        layout_config: Layout configuration dict
        ground_truth_text: Confirmed caption text
    """

    video_id: str
    caption_id: int
    start_frame: int
    end_frame: int
    main_image: Image.Image
    font_image: Image.Image
    ocr_annotations: list[list[Any]]
    layout_config: dict[str, Any]
    ground_truth_text: str


def find_all_video_dirs(data_root: Path) -> list[Path]:
    """Find all video directories in data root.

    Looks for directories containing captions.db files.

    Args:
        data_root: Root data directory (e.g., !__local/data/_has_been_deprecated__!/)

    Returns:
        List of video directory paths
    """
    video_dirs = []

    for db_path in data_root.rglob("captions.db"):
        video_dir = db_path.parent
        video_dirs.append(video_dir)

    return sorted(video_dirs)


def get_confirmed_text_annotations(db_path: Path) -> list[dict[str, Any]]:
    """Get confirmed text annotations from a video database.

    Args:
        db_path: Path to captions.db

    Returns:
        List of caption dictionaries with confirmed text
    """
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Query for captions with confirmed boundaries and text
        cursor.execute("""
            SELECT
                id, start_frame_index, end_frame_index,
                text, text_status
            FROM captions
            WHERE text IS NOT NULL
              AND text != ''
              AND boundary_state = 'confirmed'
            ORDER BY start_frame_index
        """)

        rows = cursor.fetchall()
        conn.close()

        return [dict(row) for row in rows]

    except sqlite3.OperationalError:
        # Table doesn't exist or other DB error - skip this video
        return []


def find_font_example_image(video_dir: Path) -> Path | None:
    """Find font example image in video directory.

    Looks for files matching: font_example_image*.jpg

    Args:
        video_dir: Video directory path

    Returns:
        Path to font example image or None if not found
    """
    candidates = list(video_dir.glob("font_example_image*.jpg"))
    return candidates[0] if candidates else None


def load_frame_from_db(db_path: Path, frame_index: int) -> Image.Image | None:
    """Load cropped frame from database.

    Args:
        db_path: Path to captions.db
        frame_index: Frame index to load

    Returns:
        PIL Image or None if not found
    """
    from frames_db import get_frame_from_db

    frame_data = get_frame_from_db(db_path, frame_index, table="cropped_frames")
    if not frame_data:
        return None

    return frame_data.to_pil_image()


def collect_training_sample(
    video_dir: Path,
    caption: dict[str, Any],
    font_image: Image.Image,
) -> TrainingSample | None:
    """Collect a single training sample from a caption annotation.

    Args:
        video_dir: Video directory path
        caption: Caption dictionary from database
        font_image: Font example image (pre-loaded)

    Returns:
        TrainingSample or None if data is incomplete
    """
    db_path = get_database_path(video_dir)

    # Get layout config
    try:
        layout_config = get_layout_config(db_path)
    except Exception as e:
        print(f"Warning: Failed to get layout config for {video_dir}: {e}")
        return None

    # OCR annotations are no longer available (cropped_frame_ocr table removed)
    # Using empty list to maintain compatibility with existing code
    start_frame = caption["start_frame_index"]
    end_frame = caption["end_frame_index"]
    ocr_annotations: list[list[Any]] = []

    # Load main image (use start frame)
    main_image = load_frame_from_db(db_path, start_frame)
    if not main_image:
        print(f"Warning: Failed to load frame {start_frame} from {video_dir}")
        return None

    # Create video ID from relative path
    video_id = str(video_dir.relative_to(video_dir.parent.parent.parent))

    return TrainingSample(
        video_id=video_id,
        caption_id=caption["id"],
        start_frame=start_frame,
        end_frame=end_frame,
        main_image=main_image,
        font_image=font_image,
        ocr_annotations=ocr_annotations,
        layout_config=layout_config,
        ground_truth_text=caption["text"],
    )


def collect_all_training_data(
    data_root: Path,
    output_dir: Path | None = None,
    save_images: bool = False,
    generate_font_examples: bool = True,
) -> list[TrainingSample]:
    """Collect training data from all videos in data root.

    Args:
        data_root: Root data directory (e.g., !__local/data/_has_been_deprecated__!/)
        output_dir: Optional directory to save training data manifest
        save_images: If True, save images to output_dir (for debugging)
        generate_font_examples: If True, auto-generate font example images

    Returns:
        List of TrainingSample objects
    """
    # Find all video directories
    video_dirs = find_all_video_dirs(data_root)
    print(f"Found {len(video_dirs)} video directories")

    # Generate font example images first if requested
    if generate_font_examples:
        from .font_example import generate_font_example_image

        print("\nGenerating font example images...")
        for video_dir in tqdm(video_dirs, desc="Generating font examples"):
            db_path = get_database_path(video_dir)
            try:
                result = generate_font_example_image(video_dir, db_path, force=False)
                if result:
                    _, metadata = result
                    # Optionally log successful generation
            except Exception:
                # Silently skip videos that fail
                pass

    all_samples = []

    for video_dir in tqdm(video_dirs, desc="Collecting training data"):
        # Get database path
        db_path = get_database_path(video_dir)

        # Get confirmed text annotations
        captions = get_confirmed_text_annotations(db_path)
        if not captions:
            continue

        # Find font example image
        font_example_path = find_font_example_image(video_dir)
        if not font_example_path:
            print(f"Warning: No font example image found in {video_dir}")
            continue

        # Load font image once
        font_image = Image.open(font_example_path)

        # Collect samples for this video
        for caption in captions:
            sample = collect_training_sample(video_dir, caption, font_image)
            if sample:
                all_samples.append(sample)

    print(f"\nCollected {len(all_samples)} training samples from {len(video_dirs)} videos")

    # Save manifest if requested
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = output_dir / "training_manifest.jsonl"

        with open(manifest_path, "w") as f:
            for sample in all_samples:
                manifest_entry = {
                    "video_id": sample.video_id,
                    "caption_id": sample.caption_id,
                    "start_frame": sample.start_frame,
                    "end_frame": sample.end_frame,
                    "ground_truth_text": sample.ground_truth_text,
                    "layout_config": sample.layout_config,
                    "ocr_annotations": sample.ocr_annotations,
                }
                f.write(json.dumps(manifest_entry, ensure_ascii=False) + "\n")

        print(f"Saved training manifest to: {manifest_path}")

        # Save images if requested (for debugging)
        if save_images:
            images_dir = output_dir / "images"
            images_dir.mkdir(exist_ok=True)

            for i, sample in enumerate(all_samples):
                sample.main_image.save(images_dir / f"sample_{i:05d}_main.jpg")
                # Save font image once
                if i == 0:
                    sample.font_image.save(images_dir / "font_example.jpg")

            print(f"Saved {len(all_samples)} sample images to: {images_dir}")

    return all_samples


def get_training_data_stats(samples: list[TrainingSample]) -> dict[str, Any]:
    """Get statistics about training data.

    Args:
        samples: List of training samples

    Returns:
        Dictionary with statistics
    """
    # Count unique videos
    unique_videos = {s.video_id for s in samples}

    # Count text lengths
    text_lengths = [len(s.ground_truth_text) for s in samples]

    # Count OCR annotations
    ocr_counts = [len(s.ocr_annotations) for s in samples]

    return {
        "total_samples": len(samples),
        "unique_videos": len(unique_videos),
        "avg_text_length": sum(text_lengths) / len(text_lengths) if text_lengths else 0,
        "max_text_length": max(text_lengths) if text_lengths else 0,
        "avg_ocr_count": sum(ocr_counts) / len(ocr_counts) if ocr_counts else 0,
        "videos": sorted(unique_videos),
    }
