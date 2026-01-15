#!/usr/bin/env python3
"""Split video databases by update patterns for efficient DVC versioning.

Splits captions.db into:
- video.db: Immutable source frames and metadata
- fullOCR.db: Frame-level OCR detection results (occasional re-runs)
- cropping.db: Cropped frames + layout config (updated together)
- layout.db: Box labels + classification model (updated together)
- captions.db: Caption boundaries and text (separate workflow)
- state.db: Ephemeral workspace state (local only, not DVC-tracked)

Usage:
    python scripts/migrate-split-databases.py --dry-run  # Preview changes
    python scripts/migrate-split-databases.py             # Execute migration
"""

import argparse
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

# Database split configuration based on update patterns
DATABASE_TABLES = {
    "video.db": [
        "full_frames",
        "video_metadata",
    ],
    "fullOCR.db": [
        "full_frame_ocr",
    ],
    "cropping.db": [
        "cropped_frames",
        "video_layout_config",
    ],
    "layout.db": [
        "full_frame_box_labels",
        "box_classification_model",
    ],
    "captions.db": [
        "captions",
    ],
    "state.db": [  # Local only, not DVC-tracked
        "video_preferences",
        "processing_status",
        "duplicate_resolution",
        "database_metadata",
    ],
}


def get_video_directories(data_dir: Path) -> list[Path]:
    """Find all video directories containing captions.db."""
    video_dirs = []
    for hash_dir in data_dir.iterdir():
        if not hash_dir.is_dir() or hash_dir.name.startswith("."):
            continue
        for video_dir in hash_dir.iterdir():
            if not video_dir.is_dir():
                continue
            db_path = video_dir / "captions.db"
            if db_path.exists():
                video_dirs.append(video_dir)
    return sorted(video_dirs)


def get_table_size_mb(conn: sqlite3.Connection, table_name: str) -> float:
    """Get approximate size of table in MB."""
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT SUM(LENGTH(image_data)) FROM {table_name}")
        size_bytes = cursor.fetchone()[0] or 0
        return size_bytes / (1024 * 1024)
    except sqlite3.OperationalError:
        # No image_data column, return 0
        return 0


def get_table_rows(conn: sqlite3.Connection, table_name: str) -> int:
    """Get row count for table."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cursor.fetchone()[0]


def split_database(video_dir: Path, dry_run: bool = False) -> dict:
    """Split a single video's captions.db into three separate databases."""
    original_db = video_dir / "captions.db"
    backup_db = video_dir / f"annotations_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"

    stats = {
        "video_dir": str(video_dir),
        "original_size_mb": original_db.stat().st_size / (1024 * 1024),
        "databases": {},
    }

    if dry_run:
        # Just analyze, don't modify
        conn = sqlite3.connect(original_db)

        for db_name, tables in DATABASE_TABLES.items():
            print(f"  {db_name}:")
            for table in tables:
                try:
                    rows = get_table_rows(conn, table)
                    size_mb = get_table_size_mb(conn, table)
                    size_str = f", {size_mb:.1f} MB" if size_mb > 0 else ""
                    print(f"    • {table}: {rows:,} rows{size_str}")
                except sqlite3.OperationalError:
                    pass  # Table doesn't exist

        conn.close()
        return stats

    # Backup original
    print(f"  Backing up to {backup_db.name}...")
    shutil.copy2(original_db, backup_db)

    # Connect to original database
    original_conn = sqlite3.connect(original_db)

    # Create connections for each output database
    output_connections = {}
    output_paths = {}
    try:
        for db_name in DATABASE_TABLES.keys():
            db_path = video_dir / db_name
            output_paths[db_name] = db_path
            output_connections[db_name] = sqlite3.connect(db_path)

        # Copy tables to their respective databases
        for db_name, tables in DATABASE_TABLES.items():
            print(f"  Creating {db_name}...")
            conn = output_connections[db_name]

            for table in tables:
                try:
                    # Get schema
                    cursor = original_conn.cursor()
                    cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table}'")
                    schema = cursor.fetchone()
                    if schema:
                        # Create table
                        conn.execute(schema[0])

                        # Copy data
                        cursor.execute(f"SELECT * FROM {table}")
                        rows = cursor.fetchall()

                        if rows:
                            placeholders = ",".join(["?"] * len(rows[0]))
                            conn.executemany(f"INSERT INTO {table} VALUES ({placeholders})", rows)

                        print(f"    ✓ {table}: {len(rows):,} rows")
                except sqlite3.OperationalError as e:
                    print(f"    ⚠ {table}: {e}")

            # Copy indices for this database's tables
            cursor = original_conn.cursor()
            cursor.execute(
                f"SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name IN ({','.join(['?'] * len(tables))})",
                tables,
            )
            for (index_sql,) in cursor.fetchall():
                if index_sql:  # Skip auto-generated indices
                    conn.execute(index_sql)

            conn.commit()

        # Get final sizes
        for db_name in DATABASE_TABLES.keys():
            db_path = output_paths[db_name]
            if db_path.exists():
                stats[f"{db_name}_size_mb"] = db_path.stat().st_size / (1024 * 1024)

    finally:
        original_conn.close()
        for conn in output_connections.values():
            conn.close()

    # Rename original captions.db to .old (keep as backup)
    old_db = video_dir / "captions.db.old"
    if not old_db.exists():  # Don't overwrite existing .old file
        print("  Renaming captions.db → captions.db.old...")
        original_db.rename(old_db)
    else:
        print("  Removing original captions.db (backup already exists)...")
        original_db.unlink()

    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir", type=Path, default=Path("local/data"), help="Path to data directory (default: local/data)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Analyze databases without making changes")
    parser.add_argument("--limit", type=int, help="Only process first N videos (for testing)")

    args = parser.parse_args()

    # Find all video directories
    video_dirs = get_video_directories(args.data_dir)

    if args.limit:
        video_dirs = video_dirs[: args.limit]

    print(f"Found {len(video_dirs)} video databases")

    if args.dry_run:
        print("\n=== DRY RUN - No changes will be made ===\n")

    # Process each video
    total_original_mb = 0
    totals_by_db = {db: 0.0 for db in DATABASE_TABLES.keys()}

    for i, video_dir in enumerate(video_dirs, 1):
        print(f"\n[{i}/{len(video_dirs)}] Processing {video_dir.name}...")

        stats = split_database(video_dir, dry_run=args.dry_run)

        total_original_mb += stats["original_size_mb"]
        if not args.dry_run:
            for db_name in DATABASE_TABLES.keys():
                totals_by_db[db_name] += stats.get(f"{db_name}_size_mb", 0)

            print(f"  Original: {stats['original_size_mb']:.1f} MB")
            for db_name in DATABASE_TABLES.keys():
                size_mb = stats.get(f"{db_name}_size_mb", 0)
                print(f"  → {db_name}: {size_mb:.1f} MB")

    # Summary
    print("\n" + "=" * 70)
    print("MIGRATION SUMMARY")
    print("=" * 70)
    print(f"Videos processed: {len(video_dirs)}")
    print(f"Total original size: {total_original_mb:.1f} MB ({total_original_mb / 1024:.1f} GB)")

    if not args.dry_run:
        print("\nSize breakdown after split:")
        for db_name in DATABASE_TABLES.keys():
            total = totals_by_db[db_name]
            pct = (total / total_original_mb * 100) if total_original_mb > 0 else 0
            print(f"  {db_name}: {total:.1f} MB ({total / 1024:.1f} GB, {pct:.1f}%)")

        print("\nBackups saved as: annotations_backup_*.db")
        print("\nNext steps:")
        print("  1. Verify migration: spot-check a few videos")
        print("  2. Set up DVC tracking: python scripts/setup-dvc-tracking.py")
        print("  3. Delete backups once verified: find local/data -name 'annotations_backup_*.db' -delete")

    print("=" * 70)


if __name__ == "__main__":
    main()
