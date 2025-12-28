"""Unit tests for video hashing utility."""

import tempfile
from pathlib import Path

import pytest

from video_utils import compute_video_hash, get_video_metadata


@pytest.mark.unit
def test_compute_video_hash_deterministic():
    """Test that same content produces same hash."""
    content = b"test video content" * 1000

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f1:
        f1.write(content)
        f1_path = Path(f1.name)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f2:
        f2.write(content)
        f2_path = Path(f2.name)

    try:
        hash1 = compute_video_hash(f1_path)
        hash2 = compute_video_hash(f2_path)

        # Same content should produce same hash
        assert hash1 == hash2
        # Hash should be 64 hex characters (SHA256)
        assert len(hash1) == 64
        assert all(c in "0123456789abcdef" for c in hash1)

    finally:
        f1_path.unlink()
        f2_path.unlink()


@pytest.mark.unit
def test_compute_video_hash_different_content():
    """Test that different content produces different hashes."""
    content1 = b"test video content 1" * 1000
    content2 = b"test video content 2" * 1000

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f1:
        f1.write(content1)
        f1_path = Path(f1.name)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f2:
        f2.write(content2)
        f2_path = Path(f2.name)

    try:
        hash1 = compute_video_hash(f1_path)
        hash2 = compute_video_hash(f2_path)

        # Different content should produce different hashes
        assert hash1 != hash2

    finally:
        f1_path.unlink()
        f2_path.unlink()


@pytest.mark.unit
def test_get_video_metadata_basic():
    """Test basic metadata extraction."""
    content = b"test video" * 100

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as f:
        f.write(content)
        f_path = Path(f.name)

    try:
        metadata = get_video_metadata(f_path)

        # Check all expected fields
        assert len(metadata["video_hash"]) == 64
        assert metadata["file_size_bytes"] == len(content)
        assert str(f_path.absolute()) in metadata["video_path"]

        # Verify hash is valid hex string
        assert all(c in "0123456789abcdef" for c in metadata["video_hash"])

    finally:
        f_path.unlink()
