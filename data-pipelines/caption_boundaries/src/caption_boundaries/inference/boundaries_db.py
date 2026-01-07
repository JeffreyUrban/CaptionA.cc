"""Boundaries database creation and management.

Creates immutable per-run SQLite databases for inference results.
"""

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from rich.console import Console

console = Console(stderr=True)


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
    def from_dict(cls, data: dict[str, Any]) -> "PairResult":
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


def create_boundaries_db(
    db_path: Path,
    cropped_frames_version: int,
    model_version: str,
    run_id: str,
    started_at: datetime,
    completed_at: datetime,
    results: list[PairResult],
    model_checkpoint_path: str | None = None,
) -> Path:
    """Create boundaries database with inference results.

    Args:
        db_path: Path for new database file
        cropped_frames_version: Frame version number
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

    # Read schema
    schema_path = Path(__file__).parent.parent / "database" / "boundaries_schema.sql"
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")

    with open(schema_path) as f:
        schema_sql = f.read()

    # Create database and apply schema
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Execute schema
        cursor.executescript(schema_sql)

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
                console.print(
                    f"[cyan]  Inserted {min(i + batch_size, len(results))}/{len(results)} results[/cyan]"
                )

        conn.commit()

        # Get file size
        file_size = db_path.stat().st_size
        console.print(f"[green]✓ Created boundaries DB: {db_path.name}[/green]")
        console.print(f"  Total pairs: {len(results)}")
        console.print(f"  File size: {file_size / 1024 / 1024:.2f} MB")

    except Exception as e:
        conn.rollback()
        raise RuntimeError(f"Failed to create boundaries database: {e}") from e
    finally:
        conn.close()

    return db_path


def read_boundaries_db(db_path: Path) -> tuple[dict[str, Any], list[PairResult]]:
    """Read boundaries database metadata and results.

    Args:
        db_path: Path to boundaries database

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
    cropped_frames_version: int,
    model_version: str,
    run_id: str,
) -> str:
    """Generate filename for boundaries database.

    Args:
        cropped_frames_version: Frame version number
        model_version: Model checkpoint hash/identifier
        run_id: Inference run UUID

    Returns:
        Filename in format: v{version}_model-{hash[:8]}_run-{uuid}.db
    """
    model_hash = model_version[:8] if len(model_version) > 8 else model_version
    run_uuid = run_id[:8] if len(run_id) > 8 else run_id

    return f"v{cropped_frames_version}_model-{model_hash}_run-{run_uuid}.db"


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
