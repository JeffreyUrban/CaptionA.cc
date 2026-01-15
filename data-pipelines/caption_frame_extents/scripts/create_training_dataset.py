#!/usr/bin/env python3
"""Create training dataset from confirmed caption caption frame extents annotations.

# TODO: The database details in this file are out of date.

This script:
1. Finds all videos with confirmed caption frame extents
2. Extracts consecutive frame pairs from cropped_frames
3. Labels pairs based on caption frame extents
4. Stores in TrainingSample table with full provenance

Labels:
- same: Both frames in same caption
- different: Frames in different captions (caption-to-caption transition)
- empty_empty: Both frames have no caption
- empty_valid: Transition from no caption to caption
- valid_empty: Transition from caption to no caption
"""

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# Add src to path for direct execution
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from video_utils import get_video_metadata

from caption_frame_extents.database import (
    TrainingDataset,
    TrainingSample,
    VideoRegistry,
    init_dataset_db,
)
from caption_frame_extents.database.storage import create_dataset_session


def find_videos_with_confirmed_caption_frame_extents(
    data_dir: Path, min_confirmed: int = 5
) -> list[Path]:
    """Find all video databases with confirmed caption frame extents.

    Args:
        data_dir: Root data directory
        min_confirmed: Minimum number of confirmed caption frame extents required

    Returns:
        List of paths to captions.db files with sufficient confirmed caption frame extents
    """
    video_dbs = []

    for db_path in data_dir.glob("*/*/captions.db"):
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT COUNT(*) FROM captions "
                "WHERE caption_frame_extents_state = 'confirmed' AND caption_frame_extents_state != 'issue' AND caption_frame_extents_pending = 0"
            )
            confirmed_count = cursor.fetchone()[0]
            conn.close()

            if confirmed_count >= min_confirmed:
                video_dbs.append((db_path, confirmed_count))

        except Exception as e:
            print(f"Warning: Could not check {db_path}: {e}")
            continue

    # Sort by number of confirmed caption frame extents (descending)
    video_dbs.sort(key=lambda x: x[1], reverse=True)

    print(
        f"\nFound {len(video_dbs)} videos with >={min_confirmed} confirmed caption frame extents:"
    )
    for db_path, count in video_dbs[:10]:
        rel_path = db_path.parent.parent.name + "/" + db_path.parent.name
        print(f"  {rel_path}: {count} confirmed")
    if len(video_dbs) > 10:
        print(f"  ... and {len(video_dbs) - 10} more")

    return [db_path for db_path, _ in video_dbs]


def get_confirmed_captions(db_path: Path) -> list[tuple[int, int]]:
    """Get confirmed caption frame extents from video database.

    Args:
        db_path: Path to video's captions.db

    Returns:
        List of (start_frame_index, end_frame_index) tuples
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT start_frame_index, end_frame_index
        FROM captions
        WHERE caption_frame_extents_state = 'confirmed' AND caption_frame_extents_state != 'issue' AND caption_frame_extents_pending = 0
        ORDER BY start_frame_index
        """
    )

    captions = cursor.fetchall()
    conn.close()

    return captions


def get_cropped_frame_indices(db_path: Path) -> list[int]:
    """Get all available cropped frame indices from video database.

    Args:
        db_path: Path to video's captions.db

    Returns:
        List of frame indices that exist in cropped_frames table
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT frame_index FROM cropped_frames ORDER BY frame_index")
        frames = [row[0] for row in cursor.fetchall()]
    except sqlite3.OperationalError:
        # cropped_frames table doesn't exist
        frames = []

    conn.close()
    return frames


def label_frame_pair(
    frame1: int, frame2: int, captions: list[tuple[int, int]]
) -> str | None:
    """Determine label for a frame pair based on caption frame extents.

    Args:
        frame1: First frame index
        frame2: Second frame index
        captions: List of (start, end) caption frame extents

    Returns:
        Label string or None if pair should be skipped
    """
    # Find which caption(s) each frame belongs to
    caption1 = None
    caption2 = None

    for start, end in captions:
        if start <= frame1 <= end:
            caption1 = (start, end)
        if start <= frame2 <= end:
            caption2 = (start, end)

    # Determine label based on caption membership
    if caption1 and caption2:
        if caption1 == caption2:
            return "same"  # Both in same caption
        else:
            return "different"  # Different captions (caption transition)
    elif not caption1 and not caption2:
        return "empty_empty"  # Neither has caption
    elif not caption1 and caption2:
        return "empty_valid"  # Transition from empty to caption
    elif caption1 and not caption2:
        return "valid_empty"  # Transition from caption to empty

    return None


def extract_samples_from_video(
    db_path: Path,
    max_samples_per_video: int = 1000,
) -> list[dict]:
    """Extract training samples from a single video.

    Args:
        db_path: Path to video's captions.db
        max_samples_per_video: Maximum samples to extract per video

    Returns:
        List of sample dictionaries
    """
    # Get confirmed captions
    captions = get_confirmed_captions(db_path)
    if not captions:
        return []

    # Get available cropped frames
    frame_indices = get_cropped_frame_indices(db_path)
    if len(frame_indices) < 2:
        return []

    # Create consecutive frame pairs
    samples = []
    for i in range(len(frame_indices) - 1):
        frame1 = frame_indices[i]
        frame2 = frame_indices[i + 1]

        # Label the pair
        label = label_frame_pair(frame1, frame2, captions)
        if label is None:
            continue

        samples.append(
            {
                "frame1_index": frame1,
                "frame2_index": frame2,
                "label": label,
            }
        )

        # Limit samples per video
        if len(samples) >= max_samples_per_video:
            break

    return samples


def create_training_dataset(
    video_dbs: list[Path],
    training_db_path: Path,
    dataset_name: str,
    description: str,
    train_split_ratio: float = 0.8,
    random_seed: int = 42,
) -> int | None:
    """Create training dataset from video databases.

    Args:
        video_dbs: List of paths to video captions.db files
        training_db_path: Path to training database
        dataset_name: Name for the dataset
        description: Description of the dataset
        train_split_ratio: Ratio of training samples (0-1)
        random_seed: Random seed for split

    Returns:
        Dataset ID
    """
    import random

    random.seed(random_seed)

    # Initialize training database
    init_dataset_db(training_db_path)
    db = create_dataset_session(training_db_path)

    try:
        # Extract samples from all videos
        all_samples = []
        video_hashes = {}
        video_metadata_dict = {}

        print(f"\nExtracting samples from {len(video_dbs)} videos...")
        for i, db_path in enumerate(video_dbs, 1):
            print(
                f"[{i}/{len(video_dbs)}] Processing {db_path.parent.parent.name}/{db_path.parent.name}..."
            )

            # Get video hash
            video_path = None
            for ext in [".mp4", ".mkv", ".avi", ".mov"]:
                candidate = db_path.parent / f"{db_path.parent.name}{ext}"
                if candidate.exists():
                    video_path = candidate
                    break

            if not video_path:
                print("  ⚠️  No video file found, skipping")
                continue

            try:
                metadata = get_video_metadata(video_path)
                video_hash = metadata["video_hash"]
            except Exception as e:
                print(f"  ⚠️  Could not hash video: {e}")
                continue

            # Extract samples
            samples = extract_samples_from_video(db_path)
            if not samples:
                print("  ⚠️  No samples extracted")
                continue

            # Store samples with video hash
            for sample in samples:
                sample["video_hash"] = video_hash
                all_samples.append(sample)

            video_hashes[video_hash] = str(video_path)
            video_metadata_dict[video_hash] = {
                "video_parent": db_path.parent.parent.name,
                "video_name": db_path.parent.name,
            }

            print(f"  ✓ Extracted {len(samples)} samples")

        if not all_samples:
            print("\n❌ No samples extracted from any video")
            return None

        print(f"\nTotal samples extracted: {len(all_samples)}")

        # Compute label distribution
        label_counts = {}
        for sample in all_samples:
            label = sample["label"]
            label_counts[label] = label_counts.get(label, 0) + 1

        print("\nLabel distribution:")
        for label, count in sorted(label_counts.items()):
            print(f"  {label}: {count} ({count / len(all_samples) * 100:.1f}%)")

        # Create dataset record
        dataset = TrainingDataset(
            name=dataset_name,
            description=description,
            num_samples=len(all_samples),
            num_videos=len(video_hashes),
            label_distribution=label_counts,
            split_strategy="random",
            train_split_ratio=train_split_ratio,
            random_seed=random_seed,
            video_hashes=list(video_hashes.keys()),
            video_metadata=video_metadata_dict,
            # TODO: Track pipeline versions
            full_frames_version=None,
            crop_frames_version=None,
            layout_analysis_version=None,
            ocr_engine_version="macos_livetext",
        )

        db.add(dataset)
        db.flush()  # Get dataset ID

        print(f"\nCreated dataset: {dataset.name} (ID: {dataset.id})")

        # Register videos in video registry
        print("\nRegistering videos...")
        for video_hash, video_path_str in video_hashes.items():
            video_path = Path(video_path_str)

            # Check if already registered
            existing = (
                db.query(VideoRegistry)
                .filter(VideoRegistry.video_hash == video_hash)
                .first()
            )
            if not existing:
                video_metadata = get_video_metadata(video_path)
                registry_entry = VideoRegistry(
                    video_hash=video_hash,
                    video_path=str(video_path),
                    file_size_bytes=video_metadata["file_size_bytes"],
                )
                db.add(registry_entry)

        db.commit()
        print(f"  ✓ Registered {len(video_hashes)} videos")

        # Assign train/val splits
        print("\nAssigning train/val splits...")
        random.shuffle(all_samples)
        train_size = int(len(all_samples) * train_split_ratio)

        for i, sample_data in enumerate(all_samples):
            split = "train" if i < train_size else "val"

            sample = TrainingSample(
                dataset_id=dataset.id,
                video_hash=sample_data["video_hash"],
                frame1_index=sample_data["frame1_index"],
                frame2_index=sample_data["frame2_index"],
                label=sample_data["label"],
                split=split,
                # TODO: Add OCR confidence, text, etc. from frames
            )
            db.add(sample)

        db.commit()

        train_count = sum(1 for s in all_samples[:train_size])
        val_count = len(all_samples) - train_count

        print(
            f"  ✓ Train: {train_count} samples ({train_count / len(all_samples) * 100:.1f}%)"
        )
        print(
            f"  ✓ Val: {val_count} samples ({val_count / len(all_samples) * 100:.1f}%)"
        )

        print("\n✅ Dataset created successfully!")
        print(f"   Dataset ID: {dataset.id}")
        print(f"   Total samples: {len(all_samples)}")
        print(f"   Videos: {len(video_hashes)}")

        return dataset.id

    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="Create training dataset from confirmed caption frame extents"
    )

    # Default paths
    script_dir = Path(__file__).parent.parent
    default_data_dir = script_dir.parent.parent / "local" / "data"
    default_training_db = (
        script_dir.parent.parent / "local" / "caption_frame_extents_training.db"
    )

    parser.add_argument(
        "--data-dir",
        type=Path,
        default=default_data_dir,
        help=f"Data directory containing videos (default: {default_data_dir})",
    )
    parser.add_argument(
        "--training-db",
        type=Path,
        default=default_training_db,
        help=f"Training database path (default: {default_training_db})",
    )
    parser.add_argument(
        "--name",
        type=str,
        default=f"confirmed_caption_frame_extents_{datetime.now().strftime('%Y%m%d')}",
        help="Dataset name",
    )
    parser.add_argument(
        "--description",
        type=str,
        default="Training dataset from confirmed caption frame extents",
        help="Dataset description",
    )
    parser.add_argument(
        "--min-confirmed",
        type=int,
        default=5,
        help="Minimum confirmed caption frame extents per video (default: 5)",
    )
    parser.add_argument(
        "--max-videos",
        type=int,
        help="Maximum number of videos to use (default: all)",
    )
    parser.add_argument(
        "--train-split",
        type=float,
        default=0.8,
        help="Train split ratio (default: 0.8)",
    )
    parser.add_argument(
        "--random-seed",
        type=int,
        default=42,
        help="Random seed for split (default: 42)",
    )

    args = parser.parse_args()

    print("Caption Frame Extents Training Dataset Creator")
    print("=" * 60)

    # Find videos
    video_dbs = find_videos_with_confirmed_caption_frame_extents(
        args.data_dir, args.min_confirmed
    )

    if not video_dbs:
        print(
            f"\n❌ No videos found with >= {args.min_confirmed} confirmed caption frame extents"
        )
        return 1

    # Limit videos if requested
    if args.max_videos:
        video_dbs = video_dbs[: args.max_videos]
        print(f"\nLimited to first {len(video_dbs)} videos")

    # Create dataset
    dataset_id = create_training_dataset(
        video_dbs=video_dbs,
        training_db_path=args.training_db,
        dataset_name=args.name,
        description=args.description,
        train_split_ratio=args.train_split,
        random_seed=args.random_seed,
    )

    if dataset_id is None:
        return 1

    print(f"\n{'=' * 60}")
    print("Dataset created successfully!")
    print(f"  Dataset ID: {dataset_id}")
    print(f"  Database: {args.training_db}")
    print("\nNext steps:")
    print("  1. Extract font embeddings for all videos")
    print("  2. Train model on this dataset")
    print(f"{'=' * 60}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
