#!/usr/bin/env python3
"""Set up DVC tracking for split video databases.

Run this after migrate-split-databases.py to track split databases with DVC.

Tracks: video.db, fullOCR.db, layout.db, captions.db

Usage:
    python scripts/setup-dvc-tracking.py --dry-run  # Preview DVC commands
    python scripts/setup-dvc-tracking.py             # Execute DVC tracking
"""

# TODO: The database details in this file are out of date.

import argparse
import subprocess
from pathlib import Path


def get_video_directories(data_dir: Path) -> list[Path]:
    """Find all video directories with split databases."""
    video_dirs = []
    for hash_dir in data_dir.iterdir():
        if not hash_dir.is_dir() or hash_dir.name.startswith("."):
            continue
        for video_dir in hash_dir.iterdir():
            if not video_dir.is_dir():
                continue
            # Check for at least video.db to identify split database structure
            video_db = video_dir / "video.db"
            if video_db.exists():
                video_dirs.append(video_dir)
    return sorted(video_dirs)


def run_command(cmd: list[str], dry_run: bool = False) -> bool:
    """Run a shell command."""
    if dry_run:
        print(f"  [DRY RUN] {' '.join(cmd)}")
        return True

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Error: {e.stderr}")
        return False


def setup_dvc_for_video(video_dir: Path, dry_run: bool = False) -> dict:
    """Set up DVC tracking for a single video's databases.

    Tracks: video.db, fullOCR.db, layout.db, captions.db

    Returns:
        Dict with tracking stats
    """
    # Databases to track with DVC
    databases_to_track = [
        "video.db",  # Immutable frames and metadata
        "fullOCR.db",  # OCR detection results
        "layout.db",  # Box annotations and classification model
        "captions.db",  # Caption boundaries and text
    ]

    stats = {
        "video_dir": str(video_dir),
        "tracked": {},
        "total_size_mb": 0,
    }

    for db_name in databases_to_track:
        db_path = video_dir / db_name

        if not db_path.exists():
            print(f"  ⚠ {db_name} not found, skipping...")
            continue

        size_mb = db_path.stat().st_size / (1024 * 1024)
        print(f"  Tracking {db_name} ({size_mb:.1f} MB)...")

        if run_command(["dvc", "add", str(db_path)], dry_run):
            stats["tracked"][db_name] = size_mb
            stats["total_size_mb"] += size_mb

    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir", type=Path, default=Path("!__local/data/_has_been_deprecated__!"), help="Path to data directory (default: !__local/data/_has_been_deprecated__!)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would be tracked without making changes")
    parser.add_argument("--limit", type=int, help="Only process first N videos (for testing)")

    args = parser.parse_args()

    # Find all video directories
    video_dirs = get_video_directories(args.data_dir)

    if args.limit:
        video_dirs = video_dirs[: args.limit]

    print(f"Found {len(video_dirs)} videos with split databases")

    if args.dry_run:
        print("\n=== DRY RUN - No DVC tracking will occur ===\n")

    # Track each video
    total_size_by_db = {
        "video.db": 0,
        "fullOCR.db": 0,
        "layout.db": 0,
        "captions.db": 0,
    }
    total_size_mb = 0
    tracked_count = 0

    for i, video_dir in enumerate(video_dirs, 1):
        print(f"\n[{i}/{len(video_dirs)}] {video_dir.name}...")

        stats = setup_dvc_for_video(video_dir, dry_run=args.dry_run)

        if stats["tracked"]:
            tracked_count += 1
            total_size_mb += stats["total_size_mb"]
            for db_name, size_mb in stats["tracked"].items():
                total_size_by_db[db_name] += size_mb

    # Summary
    print("\n" + "=" * 70)
    print("DVC TRACKING SUMMARY")
    print("=" * 70)
    print(f"Videos tracked: {tracked_count}/{len(video_dirs)}")
    print("\nSize breakdown:")
    for db_name, size_mb in total_size_by_db.items():
        if size_mb > 0:
            print(f"  {db_name}: {size_mb:.1f} MB ({size_mb / 1024:.2f} GB)")
    print(f"\nTotal tracked: {total_size_mb:.1f} MB ({total_size_mb / 1024:.2f} GB)")

    if not args.dry_run:
        print("\nNext steps:")
        print("  2. Stage .dvc files: git add '!__local/data/_has_been_deprecated__!/**/*.dvc'")
        print("  3. Stage .gitignore: git add '!__local/data/_has_been_deprecated__!/**/.gitignore'")
        print("  4. Commit: git commit -m 'Set up DVC tracking for split databases'")
        print("  5. Push to DVC: dvc push")
        print("  6. Push to git: git push")

    print("=" * 70)


if __name__ == "__main__":
    main()
