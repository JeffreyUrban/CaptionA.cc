#!/usr/bin/env python3
"""Run migration 002: Add analysis_model_version column to all databases.

This migration adds analysis_model_version to video_layout_config to track
which model version was used for the current crop bounds.

Usage:
    python3 scripts/run-migration-002.py [--dry-run]
"""

import argparse
import sqlite3
from pathlib import Path


def get_database_paths(data_dir: Path) -> list[Path]:
    """Find all video databases."""
    databases = []
    for parent_dir in sorted(data_dir.iterdir()):
        if not parent_dir.is_dir():
            continue
        for video_dir in sorted(parent_dir.iterdir()):
            if not video_dir.is_dir():
                continue
            db_path = video_dir / "annotations.db"
            if db_path.exists():
                databases.append(db_path)
    return databases


def run_migration(db_path: Path, dry_run: bool = False) -> tuple[bool, str]:
    """Run migration on a single database."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if column already exists
        cursor.execute("PRAGMA table_info(video_layout_config)")
        columns = [row[1] for row in cursor.fetchall()]

        if "analysis_model_version" in columns:
            conn.close()
            return True, "Column already exists"

        if dry_run:
            conn.close()
            return True, "Would add column"

        # Add column
        cursor.execute("ALTER TABLE video_layout_config ADD COLUMN analysis_model_version TEXT")

        # Populate with current model version (if model exists)
        cursor.execute("SELECT model_version FROM box_classification_model WHERE id = 1")
        result = cursor.fetchone()

        if result:
            current_model_version = result[0]
            cursor.execute(
                """
                UPDATE video_layout_config
                SET analysis_model_version = ?
                WHERE id = 1 AND analysis_model_version IS NULL
                """,
                (current_model_version,),
            )

        conn.commit()
        conn.close()

        return True, f"Added column, set to {current_model_version if result else 'NULL'}"

    except Exception as e:
        return False, f"Error: {str(e)[:100]}"


def main():
    parser = argparse.ArgumentParser(description="Run migration 002 on all databases")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    args = parser.parse_args()

    # Find all databases
    data_dir = Path(__file__).parent.parent / "local" / "data"
    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        return

    print(f"Scanning for video databases in {data_dir}...")
    databases = get_database_paths(data_dir)
    print(f"Found {len(databases)} video databases\n")

    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made\n")

    # Run migration on each database
    success_count = 0
    already_exists_count = 0
    error_count = 0

    for i, db_path in enumerate(databases, 1):
        # Get display path
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT display_path FROM video_metadata WHERE id = 1")
            result = cursor.fetchone()
            display_path = result[0] if result else str(db_path.parent.name)
            conn.close()
        except Exception:
            display_path = str(db_path.parent.name)

        success, message = run_migration(db_path, args.dry_run)

        if success:
            if "already exists" in message:
                already_exists_count += 1
            else:
                success_count += 1
                print(f"[{i}/{len(databases)}] ✓ {display_path}: {message}")
        else:
            error_count += 1
            print(f"[{i}/{len(databases)}] ✗ {display_path}: {message}")

    # Summary
    print("\n" + "=" * 70)
    print("Migration complete:")
    print(f"  ✅ Migrated: {success_count}")
    print(f"  ⏭️  Already migrated: {already_exists_count}")
    print(f"  ❌ Errors: {error_count}")
    print("=" * 70)

    if args.dry_run:
        print("\n💡 Run without --dry-run to apply migration")


if __name__ == "__main__":
    main()
