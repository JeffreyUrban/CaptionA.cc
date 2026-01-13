"""Test script for caption frame extents database operations.

Tests SQLite database creation, writing, and reading of inference results.
"""

import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from rich.console import Console

from caption_frame_extents.inference.caption_frame_extents_db import (
    PairResult,
    compute_model_version_hash,
    create_caption_frame_extents_db,
    get_db_filename,
    read_caption_frame_extents_db,
)

console = Console(stderr=True)


def test_pair_result_from_dict():
    """Test PairResult creation from dictionary."""
    console.print("\n[cyan]Test 1: PairResult.from_dict()[/cyan]")

    data = {
        "frame1_index": 0,
        "frame2_index": 1,
        "forward_predicted_label": "same",
        "forward_confidence": 0.95,
        "forward_prob_same": 0.95,
        "forward_prob_different": 0.03,
        "forward_prob_empty_empty": 0.01,
        "forward_prob_empty_valid": 0.005,
        "forward_prob_valid_empty": 0.005,
        "backward_predicted_label": "same",
        "backward_confidence": 0.93,
        "backward_prob_same": 0.93,
        "backward_prob_different": 0.04,
        "backward_prob_empty_empty": 0.015,
        "backward_prob_empty_valid": 0.0075,
        "backward_prob_valid_empty": 0.0075,
        "processing_time_ms": 12.5,
    }

    result = PairResult.from_dict(data)

    assert result.frame1_index == 0
    assert result.frame2_index == 1
    assert result.forward_predicted_label == "same"
    assert result.forward_confidence == 0.95
    assert result.backward_predicted_label == "same"
    assert result.processing_time_ms == 12.5

    console.print("[green]✓ PairResult.from_dict() works correctly[/green]")


def test_db_filename_generation():
    """Test database filename generation."""
    console.print("\n[cyan]Test 2: get_db_filename()[/cyan]")

    # Test with long hashes
    filename = get_db_filename(
        cropped_frames_version=1,
        model_version="test-model-version-placeholder-string",
        run_id="550e8400-e29b-41d4-a716-446655440000",
    )

    expected = "v1_model-test-mod_run-550e8400.db"
    assert filename == expected, f"Expected {expected}, got {filename}"

    console.print(f"  Generated filename: {filename}")
    console.print("[green]✓ Filename generation works correctly[/green]")


def test_create_and_read_db():
    """Test creating and reading caption frame extents database."""
    console.print("\n[cyan]Test 3: create_caption_frame_extents_db() and read_caption_frame_extents_db()[/cyan]")

    # Create temporary directory
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_caption_frame_extents.db"

        # Generate test data (100 frame pairs)
        results = []
        for i in range(100):
            result = PairResult(
                frame1_index=i,
                frame2_index=i + 1,
                forward_predicted_label="same" if i % 3 != 0 else "different",
                forward_confidence=0.90 + (i % 10) / 100,
                forward_prob_same=0.85,
                forward_prob_different=0.10,
                forward_prob_empty_empty=0.02,
                forward_prob_empty_valid=0.015,
                forward_prob_valid_empty=0.015,
                backward_predicted_label="same" if i % 3 != 0 else "different",
                backward_confidence=0.88 + (i % 10) / 100,
                backward_prob_same=0.83,
                backward_prob_different=0.12,
                backward_prob_empty_empty=0.025,
                backward_prob_empty_valid=0.0125,
                backward_prob_valid_empty=0.0125,
                processing_time_ms=10.0 + i * 0.1,
            )
            results.append(result)

        # Create database
        run_id = "test-run-123"
        model_version = "test-model-abc123"
        started_at = datetime.now()
        completed_at = started_at + timedelta(seconds=5)

        created_db_path = create_caption_frame_extents_db(
            db_path=db_path,
            cropped_frames_version=1,
            model_version=model_version,
            run_id=run_id,
            started_at=started_at,
            completed_at=completed_at,
            results=results,
            model_checkpoint_path="/models/test_checkpoint.pt",
        )

        assert created_db_path.exists(), "Database file was not created"
        console.print(f"[green]✓ Database created: {created_db_path.name}[/green]")

        # Read database back
        metadata, read_results = read_caption_frame_extents_db(db_path)

        # Verify metadata
        assert metadata["run_id"] == run_id
        assert metadata["model_version"] == model_version
        assert metadata["cropped_frames_version"] == 1
        assert metadata["total_pairs"] == 100
        assert metadata["model_checkpoint_path"] == "/models/test_checkpoint.pt"

        console.print("[green]✓ Metadata matches:[/green]")
        console.print(f"    Run ID: {metadata['run_id']}")
        console.print(f"    Model: {metadata['model_version']}")
        console.print(f"    Total pairs: {metadata['total_pairs']}")
        console.print(f"    Processing time: {metadata['processing_time_seconds']:.2f}s")

        # Verify results
        assert len(read_results) == 100, f"Expected 100 results, got {len(read_results)}"

        # Check a few specific results
        first = read_results[0]
        assert first.frame1_index == 0
        assert first.frame2_index == 1
        assert first.forward_predicted_label == "different"  # 0 % 3 == 0
        assert first.forward_confidence == 0.90

        last = read_results[-1]
        assert last.frame1_index == 99
        assert last.frame2_index == 100
        assert last.forward_predicted_label == "different"  # 99 % 3 == 0

        console.print(f"[green]✓ All {len(read_results)} results read correctly[/green]")
        console.print(f"    First result: frames ({first.frame1_index}, {first.frame2_index})")
        console.print(f"    Last result: frames ({last.frame1_index}, {last.frame2_index})")


def test_large_batch():
    """Test with realistic batch size (25k pairs)."""
    console.print("\n[cyan]Test 4: Large batch (25k pairs)[/cyan]")

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "large_caption_frame_extents.db"

        # Generate 25k frame pairs
        console.print("  Generating 25,000 frame pairs...")
        results = []
        for i in range(25000):
            result = PairResult(
                frame1_index=i,
                frame2_index=i + 1,
                forward_predicted_label="same",
                forward_confidence=0.95,
                forward_prob_same=0.95,
                forward_prob_different=0.03,
                forward_prob_empty_empty=0.01,
                forward_prob_empty_valid=0.005,
                forward_prob_valid_empty=0.005,
                backward_predicted_label="same",
                backward_confidence=0.93,
                backward_prob_same=0.93,
                backward_prob_different=0.04,
                backward_prob_empty_empty=0.015,
                backward_prob_empty_valid=0.0075,
                backward_prob_valid_empty=0.0075,
                processing_time_ms=12.0,
            )
            results.append(result)

        # Create database
        console.print("  Creating database...")
        import time

        start = time.time()

        create_caption_frame_extents_db(
            db_path=db_path,
            cropped_frames_version=1,
            model_version="large-test-model",
            run_id="large-test-run",
            started_at=datetime.now(),
            completed_at=datetime.now() + timedelta(minutes=2),
            results=results,
        )

        create_time = time.time() - start

        # Get file size
        file_size_mb = db_path.stat().st_size / 1024 / 1024

        console.print("[green]✓ Large database created successfully[/green]")
        console.print(f"    Creation time: {create_time:.2f}s")
        console.print(f"    File size: {file_size_mb:.2f} MB")
        console.print("    Pairs: 25,000")

        # Verify read performance
        console.print("  Reading database...")
        start = time.time()
        metadata, read_results = read_caption_frame_extents_db(db_path)
        read_time = time.time() - start

        assert len(read_results) == 25000
        console.print(f"[green]✓ Read {len(read_results)} results in {read_time:.2f}s[/green]")


def test_model_version_hash():
    """Test model version hash computation."""
    console.print("\n[cyan]Test 5: compute_model_version_hash()[/cyan]")

    # Create a temporary file to hash
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(b"test model checkpoint data")
        temp_path = Path(f.name)

    try:
        hash1 = compute_model_version_hash(temp_path)
        hash2 = compute_model_version_hash(temp_path)

        # Hash should be consistent
        assert hash1 == hash2, "Hash should be deterministic"
        assert len(hash1) == 64, "SHA256 hash should be 64 chars"

        console.print(f"  Model hash: {hash1[:16]}...")
        console.print("[green]✓ Model version hash works correctly[/green]")

    finally:
        temp_path.unlink()


def main():
    """Run all tests."""
    console.print("[bold cyan]Testing Caption Frame Extents Database Operations[/bold cyan]")
    console.print("=" * 60)

    try:
        test_pair_result_from_dict()
        test_db_filename_generation()
        test_create_and_read_db()
        test_large_batch()
        test_model_version_hash()

        console.print("\n" + "=" * 60)
        console.print("[bold green]✓ All tests passed![/bold green]")

    except AssertionError as e:
        console.print(f"\n[bold red]✗ Test failed: {e}[/bold red]")
        raise
    except Exception as e:
        console.print(f"\n[bold red]✗ Unexpected error: {e}[/bold red]")
        raise


if __name__ == "__main__":
    main()
