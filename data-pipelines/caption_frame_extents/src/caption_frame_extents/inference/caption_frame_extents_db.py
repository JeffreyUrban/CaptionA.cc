"""Caption frame extents database creation and management.

Creates immutable per-run SQLite databases for inference results.
"""

from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from rich.console import Console

console = Console(stderr=True)

# Embedded schema (avoids file dependency for Modal compatibility)
CAPTION_FRAME_EXTENTS_SCHEMA = """
-- SQLite schema for caption frame extents inference database
-- Each DB file contains results from ONE inference run (immutable)
-- Filename format: v{frames_version}_model-{model_hash[:8]}_run-{uuid}.db

-- Run metadata (self-describing file)
CREATE TABLE IF NOT EXISTS run_metadata (
  cropped_frames_version INTEGER,
  model_version TEXT NOT NULL,              -- Full checkpoint hash or identifier
  model_checkpoint_path TEXT,               -- Path to model checkpoint used
  run_id TEXT PRIMARY KEY,                  -- UUID for this inference run
  started_at TEXT NOT NULL,                 -- ISO 8601 timestamp
  completed_at TEXT NOT NULL,               -- ISO 8601 timestamp
  total_pairs INTEGER NOT NULL,             -- Number of frame pairs (typically ~25k)
  processing_time_seconds REAL              -- Total processing time
);

-- Frame pair inference results
-- Combined forward + backward in same row (25k rows instead of 50k)
CREATE TABLE IF NOT EXISTS pair_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Frame pair (ordered: frame1_index < frame2_index)
  frame1_index INTEGER NOT NULL,
  frame2_index INTEGER NOT NULL,

  -- Forward direction: frame1 → frame2
  forward_predicted_label TEXT NOT NULL CHECK (
    forward_predicted_label IN ('same', 'different', 'empty_empty', 'empty_valid', 'valid_empty')
  ),
  forward_confidence REAL NOT NULL CHECK (
    forward_confidence >= 0.0 AND forward_confidence <= 1.0
  ),
  forward_prob_same REAL NOT NULL CHECK (forward_prob_same >= 0.0 AND forward_prob_same <= 1.0),
  forward_prob_different REAL NOT NULL CHECK (forward_prob_different >= 0.0 AND forward_prob_different <= 1.0),
  forward_prob_empty_empty REAL NOT NULL CHECK (forward_prob_empty_empty >= 0.0 AND forward_prob_empty_empty <= 1.0),
  forward_prob_empty_valid REAL NOT NULL CHECK (forward_prob_empty_valid >= 0.0 AND forward_prob_empty_valid <= 1.0),
  forward_prob_valid_empty REAL NOT NULL CHECK (forward_prob_valid_empty >= 0.0 AND forward_prob_valid_empty <= 1.0),

  -- Backward direction: frame2 → frame1
  backward_predicted_label TEXT NOT NULL CHECK (
    backward_predicted_label IN ('same', 'different', 'empty_empty', 'empty_valid', 'valid_empty')
  ),
  backward_confidence REAL NOT NULL CHECK (
    backward_confidence >= 0.0 AND backward_confidence <= 1.0
  ),
  backward_prob_same REAL NOT NULL CHECK (backward_prob_same >= 0.0 AND backward_prob_same <= 1.0),
  backward_prob_different REAL NOT NULL CHECK (backward_prob_different >= 0.0 AND backward_prob_different <= 1.0),
  backward_prob_empty_empty REAL NOT NULL CHECK (backward_prob_empty_empty >= 0.0 AND backward_prob_empty_empty <= 1.0),
  backward_prob_empty_valid REAL NOT NULL CHECK (backward_prob_empty_valid >= 0.0 AND backward_prob_empty_valid <= 1.0),
  backward_prob_valid_empty REAL NOT NULL CHECK (backward_prob_valid_empty >= 0.0 AND backward_prob_valid_empty <= 1.0),

  -- Processing metadata
  processing_time_ms REAL,                   -- Combined time for both directions

  -- Unique constraint (no duplicates)
  UNIQUE(frame1_index, frame2_index)
);

-- Index for efficient frame pair lookups
CREATE INDEX IF NOT EXISTS idx_pair_frames ON pair_results(frame1_index, frame2_index);
"""


@dataclass
class PairResult:
    """Result for a single frame pair (forward + backward)."""

    frame1_index: int
    frame2_index: int

    # Forward direction
    forward_predicted_label: str
    forward_confidence: float
    forward_prob_same: float
    forward_prob_different: float
    forward_prob_empty_empty: float
    forward_prob_empty_valid: float
    forward_prob_valid_empty: float

    # Backward direction
    backward_predicted_label: str
    backward_confidence: float
    backward_prob_same: float
    backward_prob_different: float
    backward_prob_empty_empty: float
    backward_prob_empty_valid: float
    backward_prob_valid_empty: float

    processing_time_ms: float | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PairResult:
        """Create from dictionary."""
        return cls(
            frame1_index=data["frame1_index"],
            frame2_index=data["frame2_index"],
            forward_predicted_label=data["forward_predicted_label"],
            forward_confidence=data["forward_confidence"],
            forward_prob_same=data.get("forward_prob_same", 0.0),
            forward_prob_different=data.get("forward_prob_different", 0.0),
            forward_prob_empty_empty=data.get("forward_prob_empty_empty", 0.0),
            forward_prob_empty_valid=data.get("forward_prob_empty_valid", 0.0),
            forward_prob_valid_empty=data.get("forward_prob_valid_empty", 0.0),
            backward_predicted_label=data["backward_predicted_label"],
            backward_confidence=data["backward_confidence"],
            backward_prob_same=data.get("backward_prob_same", 0.0),
            backward_prob_different=data.get("backward_prob_different", 0.0),
            backward_prob_empty_empty=data.get("backward_prob_empty_empty", 0.0),
            backward_prob_empty_valid=data.get("backward_prob_empty_valid", 0.0),
            backward_prob_valid_empty=data.get("backward_prob_valid_empty", 0.0),
            processing_time_ms=data.get("processing_time_ms"),
        )


def create_caption_frame_extents_db(
    db_path: Path,
    cropped_frames_version: int | None,
    model_version: str,
    run_id: str,
    started_at: datetime,
    completed_at: datetime,
    results: list[PairResult],
    model_checkpoint_path: str | None = None,
) -> Path:
    """Create caption frame extents database with inference results.

    Args:
        db_path: Path for new database file
        cropped_frames_version: Frame version number (None for unversioned)
        model_version: Model checkpoint hash/identifier
        run_id: Inference run UUID
        started_at: Run start time
        completed_at: Run completion time
        results: List of pair results
        model_checkpoint_path: Optional path to model checkpoint

    Returns:
        Path to created database
    """
    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Remove existing file if present
    if db_path.exists():
        db_path.unlink()

    # Create database and apply schema (using embedded schema for Modal compatibility)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Execute schema (embedded for Modal compatibility)
        cursor.executescript(CAPTION_FRAME_EXTENTS_SCHEMA)

        # Insert run metadata
        processing_time = (completed_at - started_at).total_seconds()

        cursor.execute(
            """
            INSERT INTO run_metadata (
                cropped_frames_version,
                model_version,
                model_checkpoint_path,
                run_id,
                started_at,
                completed_at,
                total_pairs,
                processing_time_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cropped_frames_version,
                model_version,
                model_checkpoint_path,
                run_id,
                started_at.isoformat(),
                completed_at.isoformat(),
                len(results),
                processing_time,
            ),
        )

        # Insert pair results in batches
        batch_size = 1000
        for i in range(0, len(results), batch_size):
            batch = results[i : i + batch_size]

            cursor.executemany(
                """
                INSERT INTO pair_results (
                    frame1_index,
                    frame2_index,
                    forward_predicted_label,
                    forward_confidence,
                    forward_prob_same,
                    forward_prob_different,
                    forward_prob_empty_empty,
                    forward_prob_empty_valid,
                    forward_prob_valid_empty,
                    backward_predicted_label,
                    backward_confidence,
                    backward_prob_same,
                    backward_prob_different,
                    backward_prob_empty_empty,
                    backward_prob_empty_valid,
                    backward_prob_valid_empty,
                    processing_time_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        r.frame1_index,
                        r.frame2_index,
                        r.forward_predicted_label,
                        r.forward_confidence,
                        r.forward_prob_same,
                        r.forward_prob_different,
                        r.forward_prob_empty_empty,
                        r.forward_prob_empty_valid,
                        r.forward_prob_valid_empty,
                        r.backward_predicted_label,
                        r.backward_confidence,
                        r.backward_prob_same,
                        r.backward_prob_different,
                        r.backward_prob_empty_empty,
                        r.backward_prob_empty_valid,
                        r.backward_prob_valid_empty,
                        r.processing_time_ms,
                    )
                    for r in batch
                ],
            )

            if (i + batch_size) % 5000 == 0 or i + batch_size >= len(results):
                console.print(f"[cyan]  Inserted {min(i + batch_size, len(results))}/{len(results)} results[/cyan]")

        conn.commit()

        # Get file size
        file_size = db_path.stat().st_size
        console.print(f"[green]✓ Created Caption Frame Extents DB: {db_path.name}[/green]")
        console.print(f"  Total pairs: {len(results)}")
        console.print(f"  File size: {file_size / 1024 / 1024:.2f} MB")

    except Exception as e:
        conn.rollback()
        raise RuntimeError(f"Failed to create caption frame extents database: {e}") from e
    finally:
        conn.close()

    return db_path


def read_caption_frame_extents_db(db_path: Path) -> tuple[dict[str, Any], list[PairResult]]:
    """Read caption frame extents database metadata and results.

    Args:
        db_path: Path to caption frame extents database

    Returns:
        Tuple of (metadata dict, list of PairResults)
    """
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Read metadata
        cursor.execute("SELECT * FROM run_metadata")
        metadata_row = cursor.fetchone()
        if not metadata_row:
            raise ValueError("No metadata found in database")

        metadata = dict(metadata_row)

        # Read all results
        cursor.execute(
            """
            SELECT * FROM pair_results
            ORDER BY frame1_index, frame2_index
            """
        )

        results = []
        for row in cursor.fetchall():
            result = PairResult(
                frame1_index=row["frame1_index"],
                frame2_index=row["frame2_index"],
                forward_predicted_label=row["forward_predicted_label"],
                forward_confidence=row["forward_confidence"],
                forward_prob_same=row["forward_prob_same"],
                forward_prob_different=row["forward_prob_different"],
                forward_prob_empty_empty=row["forward_prob_empty_empty"],
                forward_prob_empty_valid=row["forward_prob_empty_valid"],
                forward_prob_valid_empty=row["forward_prob_valid_empty"],
                backward_predicted_label=row["backward_predicted_label"],
                backward_confidence=row["backward_confidence"],
                backward_prob_same=row["backward_prob_same"],
                backward_prob_different=row["backward_prob_different"],
                backward_prob_empty_empty=row["backward_prob_empty_empty"],
                backward_prob_empty_valid=row["backward_prob_empty_valid"],
                backward_prob_valid_empty=row["backward_prob_valid_empty"],
                processing_time_ms=row["processing_time_ms"],
            )
            results.append(result)

        return metadata, results

    finally:
        conn.close()


def get_db_filename(
    cropped_frames_version: int | None,
    model_version: str,
    run_id: str,
) -> str:
    """Generate filename for caption frame extents database.

    Args:
        cropped_frames_version: Frame version number (None for unversioned)
        model_version: Model checkpoint hash/identifier
        run_id: Inference run UUID

    Returns:
        Filename in format: v{version}_model-{hash[:8]}_run-{uuid}.db
    """
    model_hash = model_version[:8] if len(model_version) > 8 else model_version
    run_uuid = run_id[:8] if len(run_id) > 8 else run_id
    version_str = str(cropped_frames_version) if cropped_frames_version is not None else "0"

    return f"v{version_str}_model-{model_hash}_run-{run_uuid}.db"


def compute_model_version_hash(checkpoint_path: Path) -> str:
    """Compute hash of model checkpoint for versioning.

    Args:
        checkpoint_path: Path to model checkpoint file

    Returns:
        SHA256 hash of checkpoint file
    """
    sha256 = hashlib.sha256()

    with open(checkpoint_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)

    return sha256.hexdigest()
