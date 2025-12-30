#!/usr/bin/env python3
"""Backfill temporal metadata for existing videos.

This script populates:
1. video_metadata.duration_seconds - from video file using ffprobe
2. video_preferences.index_framerate_hz - default 10.0 if missing
3. full_frame_ocr.timestamp_seconds - calculated from frame_index / index_framerate_hz
4. crop_frame_ocr.timestamp_seconds - calculated from frame_index / index_framerate_hz (if table exists)

Usage:
    python3 scripts/backfill-temporal-metadata.py [--dry-run]
"""

import argparse
import sqlite3
import sys
from pathlib import Path

# Add packages to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "packages" / "video_utils" / "src"))

from video_utils import get_video_duration


def get_database_paths(data_dir: Path) -> list[tuple[Path, Path]]:
    """Find all video databases in data directory.

    Returns:
        List of (db_path, video_path) tuples
    """
    databases = []

    # Pattern: local/data/*/*/annotations.db
    for parent_dir in sorted(data_dir.iterdir()):
        if not parent_dir.is_dir():
            continue

        for video_dir in sorted(parent_dir.iterdir()):
            if not video_dir.is_dir():
                continue

            db_path = video_dir / "annotations.db"
            if not db_path.exists():
                continue

            # Find video file in this directory
            video_files = list(video_dir.glob("*.mp4"))
            if not video_files:
                print(f"  ⚠ No video file found for {db_path}")
                continue

            databases.append((db_path, video_files[0]))

    return databases


def table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
    """Check if a table exists in the database."""
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    )
    return cursor.fetchone() is not None


def column_exists(cursor: sqlite3.Cursor, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns


def backfill_video_metadata(
    db_path: Path, video_path: Path, dry_run: bool = False
) -> tuple[bool, str]:
    """Backfill video_metadata.duration_seconds.

    Returns:
        (success, message) tuple
    """
    try:
        # Get video duration using ffprobe
        duration = get_video_duration(video_path)

        if dry_run:
            return True, f"Would set duration_seconds = {duration:.2f}s"

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if duration_seconds column exists
        if not column_exists(cursor, "video_metadata", "duration_seconds"):
            cursor.execute("ALTER TABLE video_metadata ADD COLUMN duration_seconds REAL")

        # Update duration
        cursor.execute(
            "UPDATE video_metadata SET duration_seconds = ? WHERE id = 1", (duration,)
        )

        conn.commit()
        conn.close()

        return True, f"Set duration_seconds = {duration:.2f}s"

    except Exception as e:
        return False, f"Error: {str(e)[:100]}"


def backfill_video_preferences(db_path: Path, dry_run: bool = False) -> tuple[bool, str]:
    """Backfill video_preferences.index_framerate_hz.

    Returns:
        (success, message) tuple
    """
    try:
        if dry_run:
            return True, "Would set index_framerate_hz = 10.0"

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if index_framerate_hz column exists
        if not column_exists(cursor, "video_preferences", "index_framerate_hz"):
            cursor.execute(
                "ALTER TABLE video_preferences ADD COLUMN index_framerate_hz REAL DEFAULT 10.0"
            )

        # Update to 10.0 if NULL
        cursor.execute(
            """
            UPDATE video_preferences
            SET index_framerate_hz = 10.0
            WHERE id = 1 AND index_framerate_hz IS NULL
            """
        )

        conn.commit()
        conn.close()

        return True, "Set index_framerate_hz = 10.0"

    except Exception as e:
        return False, f"Error: {str(e)[:100]}"


def backfill_frame_timestamps(
    db_path: Path, table_name: str, dry_run: bool = False
) -> tuple[bool, str]:
    """Backfill timestamp_seconds for a frame table.

    Args:
        db_path: Path to database
        table_name: Name of frame table (full_frame_ocr or crop_frame_ocr)
        dry_run: If True, don't actually update

    Returns:
        (success, message) tuple
    """
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if table exists
        if not table_exists(cursor, table_name):
            conn.close()
            return True, f"Table {table_name} does not exist (skipped)"

        # Check if timestamp_seconds column exists
        if not column_exists(cursor, table_name, "timestamp_seconds"):
            if dry_run:
                conn.close()
                return True, f"Would add timestamp_seconds column to {table_name}"

            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN timestamp_seconds REAL")

        # Get index_framerate_hz
        cursor.execute("SELECT index_framerate_hz FROM video_preferences WHERE id = 1")
        result = cursor.fetchone()
        index_framerate = result[0] if result and result[0] else 10.0

        # Count rows that need updating
        cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE timestamp_seconds IS NULL")
        null_count = cursor.fetchone()[0]

        if null_count == 0:
            conn.close()
            return True, f"All {table_name} timestamps already populated"

        if dry_run:
            conn.close()
            return (
                True,
                f"Would update {null_count} rows in {table_name} (framerate={index_framerate}Hz)",
            )

        # Update timestamps: timestamp = frame_index / framerate
        cursor.execute(
            f"""
            UPDATE {table_name}
            SET timestamp_seconds = CAST(frame_index AS REAL) / ?
            WHERE timestamp_seconds IS NULL
            """,
            (index_framerate,),
        )

        rows_updated = cursor.rowcount
        conn.commit()
        conn.close()

        return True, f"Updated {rows_updated} rows in {table_name} (framerate={index_framerate}Hz)"

    except Exception as e:
        return False, f"Error: {str(e)[:100]}"


def backfill_database(
    db_path: Path, video_path: Path, dry_run: bool = False
) -> dict[str, tuple[bool, str]]:
    """Backfill all temporal metadata for a database.

    Returns:
        Dict of {step_name: (success, message)} for each backfill step
    """
    results = {}

    # 1. Backfill video_metadata.duration_seconds
    success, message = backfill_video_metadata(db_path, video_path, dry_run)
    results["duration"] = (success, message)

    # 2. Backfill video_preferences.index_framerate_hz
    success, message = backfill_video_preferences(db_path, dry_run)
    results["framerate"] = (success, message)

    # 3. Backfill full_frame_ocr.timestamp_seconds
    success, message = backfill_frame_timestamps(db_path, "full_frame_ocr", dry_run)
    results["full_frame_timestamps"] = (success, message)

    # 4. Backfill crop_frame_ocr.timestamp_seconds (if exists)
    success, message = backfill_frame_timestamps(db_path, "crop_frame_ocr", dry_run)
    results["crop_frame_timestamps"] = (success, message)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Backfill temporal metadata for existing videos"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Show what would be done without making changes"
    )
    args = parser.parse_args()

    # Find all databases
    data_dir = Path(__file__).parent.parent / "local" / "data"
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        sys.exit(1)

    print(f"Scanning for video databases in {data_dir}...")
    databases = get_database_paths(data_dir)
    print(f"Found {len(databases)} video databases\n")

    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made\n")

    # Process each database
    total_success = 0
    total_errors = 0

    for i, (db_path, video_path) in enumerate(databases, 1):
        # Get display path from database for better output
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT display_path FROM video_metadata WHERE id = 1")
            result = cursor.fetchone()
            display_path = result[0] if result else str(db_path.parent.name)
            conn.close()
        except Exception:
            display_path = str(db_path.parent.name)

        print(f"[{i}/{len(databases)}] {display_path}")

        # Backfill all temporal metadata
        results = backfill_database(db_path, video_path, args.dry_run)

        # Print results
        all_success = True
        for step_name, (success, message) in results.items():
            status = "✓" if success else "✗"
            print(f"  {status} {step_name}: {message}")
            if not success:
                all_success = False

        if all_success:
            total_success += 1
        else:
            total_errors += 1

        print()

    # Summary
    print("=" * 60)
    print(f"Backfill complete: {total_success} successful, {total_errors} errors")

    if args.dry_run:
        print("\n💡 Run without --dry-run to apply changes")


if __name__ == "__main__":
    main()
