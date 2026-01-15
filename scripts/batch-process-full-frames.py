#!/usr/bin/env python3
"""Batch process all videos with full_frames pipeline.

This script:
1. Finds all videos in local/data/*/*/*.mp4
2. Checks if full_frames table is populated
3. Runs full_frames pipeline if needed
4. Tracks progress and errors
"""

import argparse
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def get_database_path(video_path: Path) -> Path:
    """Get captions.db path for a video file."""
    return video_path.parent / "captions.db"


def check_full_frames_populated(db_path: Path) -> tuple[bool, int]:
    """Check if full_frames table has data.

    Returns:
        Tuple of (has_frames, frame_count)
    """
    if not db_path.exists():
        return False, 0

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM full_frames")
        count = cursor.fetchone()[0]
        conn.close()
        return count > 0, count
    except Exception:
        return False, 0


def get_full_frames_output_dir(video_path: Path) -> Path:
    """Get output directory for full_frames."""
    return video_path.parent / "full_frames"


def run_full_frames_pipeline(video_path: Path, dry_run: bool = False) -> bool:
    """Run full_frames pipeline on a video.

    Returns:
        True if successful, False on error
    """
    output_dir = get_full_frames_output_dir(video_path)

    if dry_run:
        print(f"  [DRY RUN] Would run: full_frames analyze {video_path} -o {output_dir}")
        return True

    # Run full_frames pipeline
    cmd = ["uv", "run", "full_frames", "analyze", str(video_path), "--output-dir", str(output_dir)]

    try:
        result = subprocess.run(
            cmd,
            cwd="/Users/jurban/PycharmProjects/CaptionA.cc/data-pipelines/full_frames",
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour timeout per video
        )

        if result.returncode != 0:
            print("  ✗ Pipeline failed:")
            print(f"    {result.stderr[:200]}")
            return False

        return True

    except subprocess.TimeoutExpired:
        print("  ✗ Pipeline timeout (>1 hour)")
        return False
    except Exception as e:
        print(f"  ✗ Error running pipeline: {e}")
        return False


def find_all_videos(data_dir: Path) -> list[Path]:
    """Find all video files in data directory.

    Returns videos sorted by path for consistent ordering.
    """
    videos = []

    # Pattern: local/data/*/*/*.mp4
    for parent_dir in sorted(data_dir.iterdir()):
        if not parent_dir.is_dir():
            continue

        for video_dir in sorted(parent_dir.iterdir()):
            if not video_dir.is_dir():
                continue

            # Look for video files (mp4, mkv, avi, mov)
            for ext in ["*.mp4", "*.mkv", "*.avi", "*.mov"]:
                videos.extend(video_dir.glob(ext))

    return sorted(videos)


def main():
    parser = argparse.ArgumentParser(description="Batch process all videos with full_frames pipeline")

    # Default to local/data relative to script location
    script_dir = Path(__file__).parent.parent  # scripts/ -> project root
    default_data_dir = script_dir / "local" / "data"

    parser.add_argument(
        "--data-dir",
        type=Path,
        default=default_data_dir,
        help=f"Data directory containing videos (default: {default_data_dir})",
    )
    parser.add_argument("--force", action="store_true", help="Re-process videos even if full_frames already populated")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without processing")
    parser.add_argument("--limit", type=int, help="Limit number of videos to process (for testing)")

    args = parser.parse_args()

    print("Full Frames Batch Processing")
    print("=" * 60)

    if args.dry_run:
        print("DRY RUN MODE - No processing will be done\n")

    # Find all videos
    print(f"Scanning {args.data_dir} for videos...")
    videos = find_all_videos(args.data_dir)

    if not videos:
        print(f"No videos found in {args.data_dir}")
        return 1

    print(f"Found {len(videos)} videos\n")

    # Filter videos that need processing
    videos_to_process = []

    for video_path in videos:
        db_path = get_database_path(video_path)
        has_frames, count = check_full_frames_populated(db_path)

        if has_frames and not args.force:
            continue  # Skip - already processed

        videos_to_process.append((video_path, has_frames, count))

    if not videos_to_process:
        print("All videos already have full_frames populated!")
        print("Use --force to re-process anyway.")
        return 0

    print(f"Videos to process: {len(videos_to_process)}")
    print(f"Videos already done: {len(videos) - len(videos_to_process)}")
    print()

    # Apply limit if specified
    if args.limit:
        videos_to_process = videos_to_process[: args.limit]
        print(f"Limiting to first {args.limit} videos\n")

    # Process each video
    success_count = 0
    fail_count = 0

    start_time = datetime.now()

    for i, (video_path, has_frames, frame_count) in enumerate(videos_to_process, 1):
        relative_path = video_path.relative_to(args.data_dir.parent)
        status = f"re-processing ({frame_count} frames)" if has_frames else "new"

        print(f"[{i}/{len(videos_to_process)}] {relative_path} ({status})")

        if run_full_frames_pipeline(video_path, dry_run=args.dry_run):
            success_count += 1
            print("  ✓ Success")
        else:
            fail_count += 1
            # Continue processing other videos

        print()

    # Summary
    elapsed = datetime.now() - start_time

    print("=" * 60)
    print(f"Batch Processing {'Preview' if args.dry_run else 'Complete'}")
    print(f"  ✓ Success: {success_count}")
    if fail_count > 0:
        print(f"  ✗ Failed: {fail_count}")
    print(f"  Time: {elapsed}")

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
