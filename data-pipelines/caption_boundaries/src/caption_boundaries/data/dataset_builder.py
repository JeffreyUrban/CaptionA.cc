"""Build training datasets from annotated videos.

Extracts frame pairs from confirmed caption boundaries and stores them in the
central training database with comprehensive provenance tracking.
"""

import hashlib
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Literal

import Levenshtein
from rich.console import Console
from rich.progress import track
from sqlalchemy.orm import Session

from caption_boundaries.database import TrainingDataset, TrainingSample, VideoRegistry, get_training_db, init_training_db
from video_utils import get_video_metadata

console = Console(stderr=True)


def compute_video_hash(video_path: Path) -> str:
    """Compute SHA256 hash of video file.

    Args:
        video_path: Path to video file

    Returns:
        SHA256 hash as hex string
    """
    sha256_hash = hashlib.sha256()
    with open(video_path, "rb") as f:
        # Read in chunks to handle large files
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def find_video_file(db_path: Path) -> Path | None:
    """Find video file in the same directory as database.

    Args:
        db_path: Path to annotations.db file

    Returns:
        Path to video file if found, None otherwise
    """
    directory = db_path.parent
    directory_name = directory.name

    # Common video extensions
    video_extensions = [".mp4", ".mkv", ".avi", ".mov"]

    # Strategy 1: Look for file named after directory
    for ext in video_extensions:
        video_path = directory / f"{directory_name}{ext}"
        if video_path.exists():
            return video_path

    # Strategy 2: Look for "video.{ext}"
    for ext in video_extensions:
        video_path = directory / f"video{ext}"
        if video_path.exists():
            return video_path

    # Strategy 3: Look for any video file
    for ext in video_extensions:
        matching_files = list(directory.glob(f"*{ext}"))
        if matching_files:
            return matching_files[0]

    return None


def get_video_layout_metadata(db_path: Path) -> dict:
    """Extract spatial metadata from video_layout_config table.

    Args:
        db_path: Path to video's annotations.db

    Returns:
        Dict with spatial metadata
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT * FROM video_layout_config LIMIT 1")
        row = cursor.fetchone()

        if not row:
            raise ValueError(f"No layout config found in {db_path}")

        return {
            "anchor_type": row["anchor_type"] or "center",
            "vertical_position": row["vertical_position"] or 0,
            "vertical_std": row["vertical_std"] or 0,
            "box_height": row["box_height"] or 0,
            "anchor_position": row["anchor_position"] or 0,
            "crop_bounds_version": row["crop_bounds_version"],
        }

    finally:
        conn.close()


def extract_frame_pairs_from_captions(db_path: Path) -> list[dict]:
    """Extract frame pairs from confirmed caption boundaries.

    Creates training samples by comparing consecutive frames within and across
    caption boundaries:
    - Same caption: Frames within same boundary (label: 'same')
    - Different caption: Frames across boundaries (label: 'different')
    - Empty transitions: Frames with empty text (label: 'empty_empty', 'empty_valid', 'valid_empty')

    Args:
        db_path: Path to video's annotations.db

    Returns:
        List of frame pair dicts with keys:
            - frame1_index: First frame index
            - frame2_index: Second frame index
            - label: Classification label
            - text1: Text from frame 1 (for validation)
            - text2: Text from frame 2 (for validation)
            - caption_id: Source caption ID
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    pairs = []

    try:
        # Get all confirmed captions ordered by frame index
        cursor.execute(
            """
            SELECT id, start_frame_index, end_frame_index, text
            FROM captions
            WHERE boundary_state = 'confirmed'
            ORDER BY start_frame_index
        """
        )

        captions = cursor.fetchall()

        if not captions:
            return pairs

        for i, caption in enumerate(captions):
            caption_id = caption["id"]
            start_idx = caption["start_frame_index"]
            end_idx = caption["end_frame_index"]
            text = caption["text"] or ""

            # Sample within caption (same label)
            # Take pairs at different intervals to get variety
            caption_length = end_idx - start_idx + 1

            if caption_length > 1:
                # Sample pairs within caption
                # Strategy: Sample at 25%, 50%, 75% of caption duration
                sample_positions = [0.25, 0.5, 0.75]
                for pos in sample_positions:
                    frame1 = start_idx + int(caption_length * pos)
                    # Next frame (consecutive)
                    frame2 = min(frame1 + 1, end_idx)

                    if frame1 < frame2:
                        # Determine label based on text
                        if text.strip() == "":
                            label = "empty_empty"
                        else:
                            label = "same"

                        pairs.append(
                            {
                                "frame1_index": frame1,
                                "frame2_index": frame2,
                                "label": label,
                                "text1": text,
                                "text2": text,
                                "caption_id": caption_id,
                            }
                        )

            # Sample across boundaries (different label)
            if i < len(captions) - 1:
                next_caption = captions[i + 1]
                next_caption_id = next_caption["id"]
                next_start_idx = next_caption["start_frame_index"]
                next_text = next_caption["text"] or ""

                # Pair: last frame of current caption + first frame of next caption
                frame1 = end_idx
                frame2 = next_start_idx

                # Determine label based on text content
                text1_empty = text.strip() == ""
                text2_empty = next_text.strip() == ""

                if text1_empty and text2_empty:
                    label = "empty_empty"
                elif text1_empty and not text2_empty:
                    label = "empty_valid"
                elif not text1_empty and text2_empty:
                    label = "valid_empty"
                else:
                    # Both have text - this is a boundary transition
                    label = "different"

                pairs.append(
                    {
                        "frame1_index": frame1,
                        "frame2_index": frame2,
                        "label": label,
                        "text1": text,
                        "text2": next_text,
                        "caption_id": caption_id,  # Use first caption's ID
                    }
                )

        return pairs

    finally:
        conn.close()


def get_ocr_confidence_for_frame(db_path: Path, frame_index: int) -> float | None:
    """Get OCR confidence for a specific frame.

    Args:
        db_path: Path to video's annotations.db
        frame_index: Frame index to query

    Returns:
        OCR confidence, or None if no OCR data
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Query cropped_frame_ocr table (frame-level aggregated OCR)
        cursor.execute(
            """
            SELECT ocr_confidence
            FROM cropped_frame_ocr
            WHERE frame_index = ?
        """,
            (frame_index,),
        )

        row = cursor.fetchone()
        return row[0] if row and row[0] is not None else None

    finally:
        conn.close()


def get_ocr_text_for_frame(db_path: Path, frame_index: int) -> str:
    """Get OCR text for a specific frame.

    Args:
        db_path: Path to video's annotations.db
        frame_index: Frame index to query

    Returns:
        OCR text for the frame
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            SELECT ocr_text
            FROM cropped_frame_ocr
            WHERE frame_index = ?
        """,
            (frame_index,),
        )

        row = cursor.fetchone()
        return row[0] if row and row[0] else ""

    finally:
        conn.close()


def create_training_dataset(
    name: str,
    video_db_paths: list[Path],
    training_db_path: Path | None = None,
    split_strategy: Literal["random", "show_based"] = "random",
    train_split_ratio: float = 0.8,
    random_seed: int = 42,
    description: str | None = None,
) -> int:
    """Create training dataset from annotated videos.

    Args:
        name: Dataset name (must be unique)
        video_db_paths: List of paths to video annotations.db files
        training_db_path: Path to training database (uses default if None)
        split_strategy: 'random' or 'show_based' splitting
        train_split_ratio: Fraction of data for training (default: 0.8)
        random_seed: Random seed for reproducibility
        description: Optional dataset description

    Returns:
        Dataset ID

    Raises:
        ValueError: If dataset name already exists or no valid samples found
    """
    # Initialize training database
    init_training_db(training_db_path)

    console.print(f"[cyan]Creating dataset:[/cyan] {name}")
    console.print(f"Processing {len(video_db_paths)} videos...")

    # Collect all samples across videos
    all_samples = []
    video_registry_records = []
    video_hashes = []
    video_metadata_map = {}
    crop_bounds_versions = {}
    label_counts = defaultdict(int)

    for video_db_path in track(video_db_paths, description="Extracting frame pairs"):
        # Find video file
        video_file = find_video_file(video_db_path)
        if not video_file:
            console.print(f"[yellow]⚠ No video file found for {video_db_path}, skipping[/yellow]")
            continue

        # Get video hash
        try:
            metadata = get_video_metadata(video_file)
            video_hash = metadata["video_hash"]
        except Exception as e:
            console.print(f"[yellow]⚠ Failed to get metadata for {video_file}: {e}, skipping[/yellow]")
            continue

        # Get layout metadata
        try:
            layout_meta = get_video_layout_metadata(video_db_path)
        except Exception as e:
            console.print(f"[yellow]⚠ Failed to get layout metadata for {video_db_path}: {e}, skipping[/yellow]")
            continue

        # Extract frame pairs
        try:
            pairs = extract_frame_pairs_from_captions(video_db_path)
        except Exception as e:
            console.print(f"[yellow]⚠ Failed to extract pairs from {video_db_path}: {e}, skipping[/yellow]")
            continue

        if not pairs:
            console.print(f"[yellow]⚠ No confirmed captions in {video_db_path}, skipping[/yellow]")
            continue

        # Add video hash to each pair
        for pair in pairs:
            # Get OCR confidence and text for quality metadata
            ocr_conf_1 = get_ocr_confidence_for_frame(video_db_path, pair["frame1_index"])
            ocr_conf_2 = get_ocr_confidence_for_frame(video_db_path, pair["frame2_index"])

            ocr_text_1 = get_ocr_text_for_frame(video_db_path, pair["frame1_index"])
            ocr_text_2 = get_ocr_text_for_frame(video_db_path, pair["frame2_index"])

            # Calculate Levenshtein distance for "same" labels (to catch OCR mismatches)
            levenshtein_dist = None
            if pair["label"] == "same" and ocr_text_1 and ocr_text_2:
                levenshtein_dist = Levenshtein.distance(ocr_text_1, ocr_text_2)

            all_samples.append(
                {
                    "video_hash": video_hash,
                    "frame1_index": pair["frame1_index"],
                    "frame2_index": pair["frame2_index"],
                    "label": pair["label"],
                    "crop_bounds_version": layout_meta["crop_bounds_version"],
                    "source_caption_annotation_id": pair["caption_id"],
                    "ocr_confidence_frame1": ocr_conf_1,
                    "ocr_confidence_frame2": ocr_conf_2,
                    "ocr_text_frame1": ocr_text_1,
                    "ocr_text_frame2": ocr_text_2,
                    "levenshtein_distance": levenshtein_dist,
                }
            )

            label_counts[pair["label"]] += 1

        # Track video registry info (keep relative paths for worktree compatibility)
        video_hashes.append(video_hash)
        video_metadata_map[video_hash] = {
            "video_path": str(video_file),
            "file_size_bytes": metadata["file_size_bytes"],
            "duration_seconds": metadata.get("duration_seconds"),
            "width": metadata.get("width"),
            "height": metadata.get("height"),
        }
        crop_bounds_versions[video_hash] = layout_meta["crop_bounds_version"]

        # Create video registry record (keep relative paths for worktree compatibility)
        video_registry_records.append(
            VideoRegistry(
                video_hash=video_hash,
                video_path=str(video_file),
                file_size_bytes=metadata["file_size_bytes"],
                duration_seconds=metadata.get("duration_seconds"),
                width=metadata.get("width"),
                height=metadata.get("height"),
            )
        )

    if not all_samples:
        raise ValueError("No valid samples found in any video")

    console.print(f"\n[green]✓[/green] Extracted {len(all_samples)} frame pairs from {len(video_hashes)} videos")
    console.print(f"[cyan]Label distribution:[/cyan]")
    for label, count in sorted(label_counts.items()):
        console.print(f"  {label}: {count}")

    # Deduplicate samples (same video_hash + frame pair)
    seen_pairs = set()
    deduplicated_samples = []
    duplicates_removed = 0

    for sample in all_samples:
        pair_key = (sample["video_hash"], sample["frame1_index"], sample["frame2_index"])
        if pair_key not in seen_pairs:
            seen_pairs.add(pair_key)
            deduplicated_samples.append(sample)
        else:
            duplicates_removed += 1

    all_samples = deduplicated_samples

    if duplicates_removed > 0:
        console.print(f"[yellow]⚠[/yellow] Removed {duplicates_removed} duplicate frame pairs")

    # Split data
    import random

    random.seed(random_seed)

    if split_strategy == "random":
        # Stratified random split
        from sklearn.model_selection import train_test_split

        labels = [s["label"] for s in all_samples]
        train_indices, val_indices = train_test_split(
            list(range(len(all_samples))), test_size=(1 - train_split_ratio), stratify=labels, random_state=random_seed
        )

        for idx in train_indices:
            all_samples[idx]["split"] = "train"
        for idx in val_indices:
            all_samples[idx]["split"] = "val"

    else:
        # Show-based split not implemented yet
        raise NotImplementedError("Show-based split not yet implemented")

    # Calculate quality metadata
    all_confidences = [
        s["ocr_confidence_frame1"] for s in all_samples if s["ocr_confidence_frame1"] is not None
    ] + [s["ocr_confidence_frame2"] for s in all_samples if s["ocr_confidence_frame2"] is not None]

    avg_ocr_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else None
    min_samples_per_class = min(label_counts.values()) if label_counts else 0

    # Store in database
    with next(get_training_db(training_db_path)) as db:
        # Create dataset record
        dataset = TrainingDataset(
            name=name,
            description=description,
            num_samples=len(all_samples),
            num_videos=len(video_hashes),
            label_distribution=dict(label_counts),
            split_strategy=split_strategy,
            train_split_ratio=train_split_ratio,
            random_seed=random_seed,
            video_hashes=video_hashes,
            video_metadata=video_metadata_map,
            crop_bounds_versions=crop_bounds_versions,
            avg_ocr_confidence=avg_ocr_confidence,
            min_samples_per_class=min_samples_per_class,
        )

        db.add(dataset)
        db.flush()  # Get dataset ID

        # Create sample records
        sample_records = []
        for sample_data in all_samples:
            sample = TrainingSample(
                dataset_id=dataset.id,
                video_hash=sample_data["video_hash"],
                frame1_index=sample_data["frame1_index"],
                frame2_index=sample_data["frame2_index"],
                label=sample_data["label"],
                split=sample_data["split"],
                crop_bounds_version=sample_data["crop_bounds_version"],
                source_caption_annotation_id=sample_data["source_caption_annotation_id"],
                ocr_confidence_frame1=sample_data["ocr_confidence_frame1"],
                ocr_confidence_frame2=sample_data["ocr_confidence_frame2"],
                ocr_text_frame1=sample_data["ocr_text_frame1"],
                ocr_text_frame2=sample_data["ocr_text_frame2"],
                levenshtein_distance=sample_data["levenshtein_distance"],
            )
            sample_records.append(sample)

        db.add_all(sample_records)

        # Add/update video registry
        for video_record in video_registry_records:
            existing = db.query(VideoRegistry).filter(VideoRegistry.video_hash == video_record.video_hash).first()

            if existing:
                # Update last_seen_at
                from datetime import UTC, datetime

                existing.last_seen_at = datetime.now(UTC)
                existing.video_path = video_record.video_path  # Update path in case it moved
            else:
                db.add(video_record)

        db.commit()

        console.print(f"\n[green]✓[/green] Dataset created with ID: {dataset.id}")
        console.print(f"  Train samples: {sum(1 for s in all_samples if s['split'] == 'train')}")
        console.print(f"  Val samples: {sum(1 for s in all_samples if s['split'] == 'val')}")

        return dataset.id
