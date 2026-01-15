"""Migration: Drop OCR-related columns from training_samples table.

This migration removes columns that were previously used to store OCR metadata
for quality checks. These columns are no longer needed:
- ocr_confidence_frame1
- ocr_confidence_frame2
- ocr_text_frame1
- ocr_text_frame2
- levenshtein_distance
- ocr_timestamp

Run this on existing dataset databases to clean up the schema.
"""

import sqlite3
from pathlib import Path


def migrate_dataset_db(db_path: Path) -> None:
    """Drop OCR columns from training_samples table.

    Args:
        db_path: Path to dataset database file
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Check if columns exist before trying to drop them
        cursor.execute("PRAGMA table_info(training_samples)")
        columns = {row[1] for row in cursor.fetchall()}

        ocr_columns = {
            "ocr_confidence_frame1",
            "ocr_confidence_frame2",
            "ocr_text_frame1",
            "ocr_text_frame2",
            "levenshtein_distance",
            "ocr_timestamp",
        }

        columns_to_drop = ocr_columns & columns

        if not columns_to_drop:
            print(f"  No OCR columns to drop in {db_path.name}")
            return

        # SQLite doesn't support DROP COLUMN directly, need to recreate table
        # Get existing table schema (excluding OCR columns)
        cursor.execute("""
            SELECT sql FROM sqlite_master
            WHERE type='table' AND name='training_samples'
        """)
        cursor.fetchone()[0]

        # Create new table without OCR columns
        cursor.execute("BEGIN TRANSACTION")

        # Create temp table with new schema
        cursor.execute("""
            CREATE TABLE training_samples_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id INTEGER NOT NULL,
                video_hash TEXT NOT NULL,
                frame1_index INTEGER NOT NULL,
                frame2_index INTEGER NOT NULL,
                label TEXT NOT NULL,
                split TEXT NOT NULL,
                source_caption_annotation_id INTEGER,
                crop_region_version INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES training_datasets (id),
                UNIQUE (dataset_id, video_hash, frame1_index, frame2_index)
            )
        """)

        # Copy data (excluding OCR columns)
        cursor.execute("""
            INSERT INTO training_samples_new
            (id, dataset_id, video_hash, frame1_index, frame2_index, label, split,
             source_caption_annotation_id, crop_region_version, created_at)
            SELECT id, dataset_id, video_hash, frame1_index, frame2_index, label, split,
                   source_caption_annotation_id, crop_region_version, created_at
            FROM training_samples
        """)

        # Drop old table
        cursor.execute("DROP TABLE training_samples")

        # Rename new table
        cursor.execute("ALTER TABLE training_samples_new RENAME TO training_samples")

        # Recreate indexes
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS ix_training_samples_dataset_id
            ON training_samples (dataset_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS ix_training_samples_label
            ON training_samples (label)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS ix_training_samples_split
            ON training_samples (split)
        """)

        conn.commit()
        print(f"  ✓ Dropped {len(columns_to_drop)} OCR columns from {db_path.name}")

    except Exception as e:
        conn.rollback()
        print(f"  ✗ Error migrating {db_path.name}: {e}")
        raise
    finally:
        conn.close()


def main():
    """Run migration on all dataset databases."""

    # Find all dataset databases
    datasets_dir = Path(__file__).parent.parent / "../../local/models/caption_frame_extents/datasets"
    datasets_dir = datasets_dir.resolve()

    if not datasets_dir.exists():
        print(f"Datasets directory not found: {datasets_dir}")
        return

    dataset_dbs = list(datasets_dir.glob("*.db"))

    if not dataset_dbs:
        print(f"No dataset databases found in {datasets_dir}")
        return

    print(f"Found {len(dataset_dbs)} dataset databases")
    print()

    for db_path in dataset_dbs:
        print(f"Migrating {db_path.name}...")
        migrate_dataset_db(db_path)

    print()
    print("Migration complete!")


if __name__ == "__main__":
    main()
