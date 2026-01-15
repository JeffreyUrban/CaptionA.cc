"""Build training datasets from annotated videos.

# TODO: The database details in this file are out of date.

Extracts frame pairs from confirmed caption frame extents and stores them in the
central training database with comprehensive provenance tracking.
"""

import gc
import hashlib
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Literal

from rich.console import Console
from rich.progress import track
from video_utils import get_video_metadata

from caption_frame_extents.database import (
    TrainingDataset,
    TrainingSample,
    VideoRegistry,
    get_dataset_db,
    get_dataset_db_path,
    init_dataset_db,
)

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
        db_path: Path to captions.db file

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
        db_path: Path to video's captions.db

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
            "crop_region_version": row["crop_region_version"],
        }

    finally:
        conn.close()


def extract_frame_pairs_from_captions(
    db_path: Path, caption_frame_extents_states: list[str] | None = None
) -> list[dict]:
    """Extract frame pairs from caption frame extents.

    Creates training samples by comparing consecutive frames within and across
    caption frame extents:
    - Same caption: Frames within same caption frame extent (label: 'same')
    - Different caption: Frames across caption frame extents (label: 'different')
    - Empty transitions: Frames with empty text (label: 'empty_empty', 'empty_valid', 'valid_empty')

    Args:
        db_path: Path to video's captions.db
        caption_frame_extents_states: List of caption frame extents states to include (default: ['confirmed'])
                        Options: 'confirmed', 'predicted', 'issue'

    Returns:
        List of frame pair dicts with keys:
            - frame1_index: First frame index
            - frame2_index: Second frame index
            - label: Classification label
            - text1: Text from frame 1 (for validation)
            - text2: Text from frame 2 (for validation)
            - caption_id: Source caption ID
            - caption_frame_extents_state: State of the source caption
    """
    if caption_frame_extents_states is None:
        caption_frame_extents_states = ["confirmed"]

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    pairs = []

    try:
        # Get captions with specified caption frame extents states, ordered by frame index
        # Exclude 'issue' state by default unless explicitly requested
        placeholders = ",".join("?" * len(caption_frame_extents_states))
        cursor.execute(
            f"""
            SELECT id, start_frame_index, end_frame_index, text, caption_frame_extents_state
            FROM captions
            WHERE caption_frame_extents_state IN ({placeholders})
            ORDER BY start_frame_index
        """,
            caption_frame_extents_states,
        )

        captions = cursor.fetchall()

        if not captions:
            return pairs

        for i, caption in enumerate(captions):
            caption_id = caption["id"]
            start_idx = caption["start_frame_index"]
            end_idx = caption["end_frame_index"]
            text = caption["text"] or ""
            caption_frame_extents_state = caption["caption_frame_extents_state"]

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
                                "caption_frame_extents_state": caption_frame_extents_state,
                            }
                        )

            # Sample across caption_frame_extents (different label)
            if i < len(captions) - 1:
                next_caption = captions[i + 1]
                next_caption["id"]
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
                    # Both have text - this is a caption frame extents transition
                    label = "different"

                pairs.append(
                    {
                        "frame1_index": frame1,
                        "frame2_index": frame2,
                        "label": label,
                        "text1": text,
                        "text2": next_text,
                        "caption_id": caption_id,  # Use first caption's ID
                        "caption_frame_extents_state": caption_frame_extents_state,  # Use first caption's state
                    }
                )

        return pairs

    finally:
        conn.close()


def _copy_frames_for_video(
    db, video_conn, video_hash: str, video_samples: list[dict]
) -> None:
    """Copy frames needed by samples from video DB to training DB.

    Args:
        db: Training database session
        video_conn: Open SQLite connection to video's captions.db
        video_hash: Video hash
        video_samples: List of samples for this video
    """
    from caption_frame_extents.database import TrainingFrame

    # Collect unique frames needed for this video
    frames_needed = set()
    for sample in video_samples:
        frames_needed.add(sample["frame1_index"])
        frames_needed.add(sample["frame2_index"])

    # Check which frames already exist in training DB
    existing_frames = set()
    for frame_index in frames_needed:
        existing = (
            db.query(TrainingFrame)
            .filter(
                TrainingFrame.video_hash == video_hash,
                TrainingFrame.frame_index == frame_index,
            )
            .first()
        )
        if existing:
            existing_frames.add(frame_index)

    frames_to_copy = frames_needed - existing_frames

    if not frames_to_copy:
        return  # All frames already exist

    # Copy frames from video DB using provided connection
    cursor = video_conn.cursor()

    for frame_index in frames_to_copy:
        cursor.execute(
            """
            SELECT image_data, width, height, file_size
            FROM cropped_frames
            WHERE frame_index = ?
            """,
            (frame_index,),
        )

        row = cursor.fetchone()
        if not row:
            console.print(f"[yellow]⚠ Frame {frame_index} not found, skipping[/yellow]")
            continue

        # Create training frame record
        training_frame = TrainingFrame(
            video_hash=video_hash,
            frame_index=frame_index,
            image_data=row[0],
            width=row[1],
            height=row[2],
            file_size=row[3],
        )
        db.add(training_frame)


def _copy_ocr_viz_for_video(
    db, video_conn, video_hash: str, has_samples: bool, variant: str = "boundaries"
) -> bool:
    """Copy OCR visualization from video DB to training DB.

    Only processes videos that have training samples.
    Returns whether OCR visualization exists for this video.

    Args:
        db: Training database session
        video_conn: Open SQLite connection to video's captions.db
        video_hash: Video hash
        has_samples: Whether this video has training samples in the dataset
        variant: OCR visualization variant (default: 'boundaries')

    Returns:
        True if OCR visualization exists (or was copied), False otherwise
    """
    from caption_frame_extents.database import TrainingOCRVisualization

    # Skip if no training samples for this video
    if not has_samples:
        return False

    # Check if visualization already exists
    existing = (
        db.query(TrainingOCRVisualization)
        .filter(
            TrainingOCRVisualization.video_hash == video_hash,
            TrainingOCRVisualization.variant == variant,
        )
        .first()
    )

    if existing:
        return True  # Already exists

    # Try to copy from video DB
    cursor = video_conn.cursor()
    cursor.execute(
        "SELECT ocr_visualization_image FROM video_layout_config WHERE id = 1"
    )

    row = cursor.fetchone()
    if not row or not row[0]:
        # OCR visualization not found
        return False

    # Create training OCR visualization record
    training_ocr_viz = TrainingOCRVisualization(
        video_hash=video_hash, variant=variant, image_data=row[0]
    )
    db.add(training_ocr_viz)
    return True


def create_training_dataset(
    name: str,
    video_db_paths: list[Path],
    split_strategy: Literal["random", "show_based"] = "random",
    train_split_ratio: float = 0.8,
    random_seed: int = 42,
    description: str | None = None,
) -> Path:
    """Create training dataset from annotated videos.

    Creates a self-contained dataset database with all necessary data:
    - Dataset metadata and samples
    - Frame image BLOBs
    - OCR visualization BLOBs
    - Video registry

    Args:
        name: Dataset name (will be used as database filename)
        video_db_paths: List of paths to video captions.db files
        split_strategy: How to split data:
            - 'random': Stratified random split
        train_split_ratio: Fraction of data for training (default: 0.8)
        random_seed: Random seed for reproducibility
        description: Optional dataset description

    Returns:
        Path to created dataset database

    Raises:
        ValueError: If dataset already exists or no valid samples found
    """

    # Get dataset database path from name
    dataset_db_path = get_dataset_db_path(name)

    # Check if dataset already exists (fail fast)
    if dataset_db_path.exists():
        console.print(
            f"[red]✗ Dataset '{name}' already exists at {dataset_db_path}[/red]"
        )
        console.print(
            "[yellow]Delete the existing dataset or choose a different name:[/yellow]"
        )
        console.print(f"  rm {dataset_db_path}")
        raise ValueError(f"Dataset '{name}' already exists")

    # Initialize dataset database
    init_dataset_db(dataset_db_path)

    console.print(f"[cyan]Creating dataset:[/cyan] {name}")
    console.print(f"Processing {len(video_db_paths)} videos...")

    # Collect all samples across videos
    all_samples = []
    video_registry_records = []
    video_hashes = []
    video_metadata_map = {}
    crop_region_versions = {}
    label_counts = defaultdict(int)
    skipped_videos = []  # Collect warnings to display after progress bar

    for video_db_path in track(video_db_paths, description="Extracting frame pairs"):
        # Find video file
        video_file = find_video_file(video_db_path)
        if not video_file:
            skipped_videos.append((video_db_path, "No video file found"))
            continue

        # Get video hash
        try:
            metadata = get_video_metadata(video_file)
            video_hash = metadata["video_hash"]
        except Exception as e:
            skipped_videos.append((video_db_path, f"Failed to get metadata: {e}"))
            continue

        # Get layout metadata
        try:
            layout_meta = get_video_layout_metadata(video_db_path)
        except Exception as e:
            skipped_videos.append(
                (video_db_path, f"Failed to get layout metadata: {e}")
            )
            continue

        # Extract frame pairs based on split strategy
        try:
            # Extract only confirmed annotations (default)
            pairs = extract_frame_pairs_from_captions(
                video_db_path, caption_frame_extents_states=["confirmed"]
            )
        except Exception as e:
            skipped_videos.append((video_db_path, f"Failed to extract pairs: {e}"))
            continue

        if not pairs:
            skipped_videos.append((video_db_path, "No confirmed captions"))
            continue

        # Add video hash to each pair
        for pair in pairs:
            all_samples.append(
                {
                    "video_hash": video_hash,
                    "frame1_index": pair["frame1_index"],
                    "frame2_index": pair["frame2_index"],
                    "label": pair["label"],
                    "crop_region_version": layout_meta["crop_region_version"],
                    "source_caption_annotation_id": pair["caption_id"],
                    "caption_frame_extents_state": pair[
                        "caption_frame_extents_state"
                    ],  # Include caption frame extents state for split logic
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
        crop_region_versions[video_hash] = layout_meta["crop_region_version"]

        # Store video registry data (will create objects in database session)
        video_registry_records.append(
            {
                "video_hash": video_hash,
                "video_path": str(video_file),
                "file_size_bytes": metadata["file_size_bytes"],
                "duration_seconds": metadata.get("duration_seconds"),
                "width": metadata.get("width"),
                "height": metadata.get("height"),
            }
        )

    if not all_samples:
        raise ValueError("No valid samples found in any video")

    console.print(
        f"\n[green]✓[/green] Extracted {len(all_samples)} frame pairs from {len(video_hashes)} videos"
    )
    console.print("[cyan]Label distribution:[/cyan]")
    for label, count in sorted(label_counts.items()):
        console.print(f"  {label}: {count}")

    # Display skipped videos if any
    if skipped_videos:
        console.print(f"\n[yellow]⚠ Skipped {len(skipped_videos)} videos:[/yellow]")
        for video_path, reason in skipped_videos[:10]:  # Show first 10
            console.print(f"  {video_path.parent.name}: {reason}")
        if len(skipped_videos) > 10:
            console.print(f"  ... and {len(skipped_videos) - 10} more")

    # Deduplicate samples (same video_hash + frame pair)
    seen_pairs = set()
    deduplicated_samples = []
    duplicates_removed = 0

    for sample in all_samples:
        pair_key = (
            sample["video_hash"],
            sample["frame1_index"],
            sample["frame2_index"],
        )
        if pair_key not in seen_pairs:
            seen_pairs.add(pair_key)
            deduplicated_samples.append(sample)
        else:
            duplicates_removed += 1

    all_samples = deduplicated_samples

    if duplicates_removed > 0:
        console.print(
            f"[yellow]⚠[/yellow] Removed {duplicates_removed} duplicate frame pairs"
        )

    # Split data
    import random

    random.seed(random_seed)

    if split_strategy == "random":
        # Stratified random split
        from sklearn.model_selection import train_test_split

        labels = [s["label"] for s in all_samples]
        train_indices, val_indices = train_test_split(
            list(range(len(all_samples))),
            test_size=(1 - train_split_ratio),
            stratify=labels,
            random_state=random_seed,
        )

        for idx in train_indices:
            all_samples[idx]["split"] = "train"
        for idx in val_indices:
            all_samples[idx]["split"] = "val"

    else:
        # Show-based split not implemented yet
        raise NotImplementedError(
            f"Split strategy '{split_strategy}' not yet implemented"
        )

    # Calculate quality metadata
    # Note: OCR confidence tracking removed - samples have no OCR metadata
    avg_ocr_confidence = None
    min_samples_per_class = min(label_counts.values()) if label_counts else 0

    # Create dataset record and get ID
    console.print("[cyan]Creating dataset record...[/cyan]")
    with next(get_dataset_db(dataset_db_path)) as db:
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
            crop_region_versions=crop_region_versions,
            avg_ocr_confidence=avg_ocr_confidence,
            min_samples_per_class=min_samples_per_class,
        )

        db.add(dataset)
        db.flush()  # Get dataset ID
        dataset_id = dataset.id
        db.commit()

    console.print(f"[green]✓[/green] Dataset record created with ID: {dataset_id}")

    # Group samples by video for per-video processing
    samples_by_video = defaultdict(list)
    for sample in all_samples:
        samples_by_video[sample["video_hash"]].append(sample)

    # Build video DB path mapping for videos that have samples
    # Read video_hash from database instead of video file
    video_db_map = {}
    for video_db_path in video_db_paths:
        try:
            conn = sqlite3.connect(video_db_path)
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT video_hash FROM video_metadata LIMIT 1")
                row = cursor.fetchone()
                if row:
                    video_hash = row[0]
                    # Only include videos that contributed samples
                    if video_hash in samples_by_video:
                        video_db_map[video_hash] = video_db_path
            finally:
                conn.close()
        except Exception:
            continue

    # Process each video: copy frames, copy OCR viz, insert samples
    # IMPORTANT: Only include samples from videos with OCR visualizations
    # Use a single database session for all videos to avoid creating too many engines
    # Process in batches to limit simultaneous open connections
    console.print(
        f"\n[cyan]Consolidating {len(samples_by_video)} videos to training database...[/cyan]"
    )

    BATCH_SIZE = 50  # Maximum simultaneous connections to video databases
    video_hashes = list(samples_by_video.keys())

    # Track which videos have OCR visualizations
    videos_with_ocr_viz = set()
    videos_without_ocr_viz = set()

    with next(get_dataset_db(dataset_db_path)) as db:
        # Process videos in batches to limit open file descriptors
        for batch_start in range(0, len(video_hashes), BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(video_hashes))
            batch_hashes = video_hashes[batch_start:batch_end]

            batch_num = batch_start // BATCH_SIZE + 1
            total_batches = (len(video_hashes) + BATCH_SIZE - 1) // BATCH_SIZE
            for video_hash in track(
                batch_hashes, description=f"Copying batch {batch_num}/{total_batches}"
            ):
                video_samples = samples_by_video[video_hash]
                video_db_path = video_db_map.get(video_hash)

                if not video_db_path:
                    console.print(
                        f"[yellow]⚠ Could not find video DB for {video_hash}, skipping[/yellow]"
                    )
                    continue

                # Open video database once for all operations
                video_conn = sqlite3.connect(video_db_path)
                try:
                    # Copy frames for this video
                    _copy_frames_for_video(db, video_conn, video_hash, video_samples)

                    # Copy OCR visualization for this video (only if has samples)
                    has_ocr_viz = _copy_ocr_viz_for_video(
                        db, video_conn, video_hash, has_samples=True
                    )

                    if has_ocr_viz:
                        videos_with_ocr_viz.add(video_hash)
                    else:
                        videos_without_ocr_viz.add(video_hash)
                finally:
                    video_conn.close()

                # Only insert samples for videos WITH OCR visualization
                if video_hash in videos_with_ocr_viz:
                    for sample_data in video_samples:
                        sample = TrainingSample(
                            dataset_id=dataset_id,
                            video_hash=sample_data["video_hash"],
                            frame1_index=sample_data["frame1_index"],
                            frame2_index=sample_data["frame2_index"],
                            label=sample_data["label"],
                            split=sample_data["split"],
                            crop_region_version=sample_data["crop_region_version"],
                            source_caption_annotation_id=sample_data[
                                "source_caption_annotation_id"
                            ],
                        )
                        db.add(sample)

                # Add/update video registry
                for video_record_data in video_registry_records:
                    if video_record_data["video_hash"] != video_hash:
                        continue

                    existing = (
                        db.query(VideoRegistry)
                        .filter(
                            VideoRegistry.video_hash == video_record_data["video_hash"]
                        )
                        .first()
                    )

                    if existing:
                        from datetime import UTC, datetime

                        existing.last_seen_at = datetime.now(UTC)
                        existing.video_path = video_record_data["video_path"]
                    else:
                        # Create VideoRegistry object from dict
                        video_record = VideoRegistry(**video_record_data)
                        db.add(video_record)

            # Commit batch and force cleanup before next batch
            db.commit()
            gc.collect()

    console.print("\n[green]✓[/green] Dataset created successfully!")
    console.print(f"  Name: {name}")
    console.print(f"  Database: {dataset_db_path}")

    # Calculate actual inserted counts (only videos with OCR viz)
    with next(get_dataset_db(dataset_db_path)) as db:
        actual_train_count = (
            db.query(TrainingSample).filter(TrainingSample.split == "train").count()
        )
        actual_val_count = (
            db.query(TrainingSample).filter(TrainingSample.split == "val").count()
        )

    console.print(f"  Train samples: {actual_train_count}")
    console.print(f"  Val samples: {actual_val_count}")

    # Report excluded samples due to missing OCR visualization
    if videos_without_ocr_viz:
        excluded_sample_count = sum(
            len(samples_by_video[vh]) for vh in videos_without_ocr_viz
        )
        console.print(
            "\n[yellow]⚠ Excluded samples (missing OCR visualization):[/yellow]"
        )
        console.print(
            f"  Videos excluded: {len(videos_without_ocr_viz)} / {len(samples_by_video)}"
        )
        console.print(f"  Samples excluded: {excluded_sample_count}")
        console.print(f"  Videos with complete data: {len(videos_with_ocr_viz)}")

    return dataset_db_path
