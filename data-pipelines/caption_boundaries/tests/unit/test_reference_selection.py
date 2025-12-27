"""Unit tests for reference frame selection."""

import sqlite3
import tempfile
from pathlib import Path

import pytest

from caption_boundaries.data import (
    ReferenceFrameCandidate,
    get_all_frame_candidates,
    get_reference_frame_stats,
    select_reference_frame,
    select_reference_frame_simple,
)


@pytest.fixture
def test_db():
    """Create a temporary test database with OCR data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "annotations.db"
        conn = sqlite3.connect(db_path)

        # Create full_frame_ocr table
        conn.execute(
            """
            CREATE TABLE full_frame_ocr (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                confidence REAL NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(frame_index, box_index)
            )
        """
        )

        # Insert sample OCR data
        # Frame 10: 25 boxes, high confidence (0.92)
        for i in range(25):
            conn.execute(
                """
                INSERT INTO full_frame_ocr (frame_index, box_index, text, confidence, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (10, i, f"char{i}", 0.92, i * 10, 100, 8, 12),
            )

        # Frame 20: 30 boxes, medium confidence (0.88)
        for i in range(30):
            conn.execute(
                """
                INSERT INTO full_frame_ocr (frame_index, box_index, text, confidence, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (20, i, f"char{i}", 0.88, i * 10, 100, 8, 12),
            )

        # Frame 30: 15 boxes, very high confidence (0.95)
        for i in range(15):
            conn.execute(
                """
                INSERT INTO full_frame_ocr (frame_index, box_index, text, confidence, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (30, i, f"char{i}", 0.95, i * 10, 100, 8, 12),
            )

        # Frame 40: 5 boxes, low confidence (0.60) - below threshold
        for i in range(5):
            conn.execute(
                """
                INSERT INTO full_frame_ocr (frame_index, box_index, text, confidence, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (40, i, f"char{i}", 0.60, i * 10, 100, 8, 12),
            )

        # Frame 50: 8 boxes, high confidence (0.90) - below box threshold
        for i in range(8):
            conn.execute(
                """
                INSERT INTO full_frame_ocr (frame_index, box_index, text, confidence, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (50, i, f"char{i}", 0.90, i * 10, 100, 8, 12),
            )

        conn.commit()
        conn.close()

        yield db_path


@pytest.mark.unit
def test_select_reference_frame_basic(test_db):
    """Test basic reference frame selection."""
    result = select_reference_frame(test_db)

    assert result is not None
    assert isinstance(result, ReferenceFrameCandidate)

    # Default selection: among top_k=5 candidates (by box count),
    # selects frame with highest confidence
    # Top candidates: frame 20 (30 boxes, 0.88), frame 10 (25 boxes, 0.92), frame 30 (15 boxes, 0.95)
    # Should select frame 30 (highest confidence among top candidates)
    assert result.frame_index == 30
    assert result.num_ocr_boxes == 15
    assert result.mean_confidence == pytest.approx(0.95, rel=0.01)
    assert len(result.ocr_boxes) == 15


@pytest.mark.unit
def test_select_reference_frame_filters_by_min_boxes(test_db):
    """Test that frames with too few boxes are filtered out."""
    # With higher min_ocr_boxes threshold, frame 30 (15 boxes) should be excluded
    result = select_reference_frame(test_db, min_ocr_boxes=20)

    assert result is not None
    # Should be frame 10 or 20 (both have >= 20 boxes)
    assert result.frame_index in [10, 20]
    assert result.num_ocr_boxes >= 20


@pytest.mark.unit
def test_select_reference_frame_filters_by_confidence(test_db):
    """Test that frames with low confidence are filtered out."""
    # Frame 40 has confidence 0.60, should be excluded with min_confidence=0.70
    result = select_reference_frame(test_db, min_confidence=0.85)

    assert result is not None
    # Should exclude frames 20 (0.88) and below
    assert result.mean_confidence >= 0.85
    assert result.frame_index in [10, 30]  # Only these have conf >= 0.85


@pytest.mark.unit
def test_select_reference_frame_selects_highest_confidence_among_top_k(test_db):
    """Test that among top_k candidates, highest confidence is selected."""
    result = select_reference_frame(test_db, top_k=3)

    # Top 3 by boxes: frame 20 (30), frame 10 (25), frame 30 (15)
    # Among these, frame 30 has highest confidence (0.95)
    # But frame 20 has most boxes (30), so it depends on selection logic

    # Our implementation selects highest confidence among top_k
    # Top 3: frame 20 (30 boxes, 0.88), frame 10 (25 boxes, 0.92), frame 30 (15 boxes, 0.95)
    # Should select frame 30 (highest conf among top 3)
    assert result is not None
    assert result.frame_index == 30
    assert result.mean_confidence == pytest.approx(0.95, rel=0.01)


@pytest.mark.unit
def test_select_reference_frame_no_candidates(test_db):
    """Test that None is returned when no frames meet criteria."""
    # Set impossible criteria
    result = select_reference_frame(test_db, min_ocr_boxes=100, min_confidence=0.99)

    assert result is None


@pytest.mark.unit
def test_select_reference_frame_simple_basic():
    """Test simplified selection from pre-aggregated data."""
    ocr_data = [
        {"frame_index": 10, "num_boxes": 25, "mean_confidence": 0.92},
        {"frame_index": 20, "num_boxes": 30, "mean_confidence": 0.88},
        {"frame_index": 30, "num_boxes": 15, "mean_confidence": 0.95},
    ]

    result = select_reference_frame_simple(ocr_data)

    # Should select frame with most boxes (30)
    assert result == 20


@pytest.mark.unit
def test_select_reference_frame_simple_filters():
    """Test simplified selection applies filters."""
    ocr_data = [
        {"frame_index": 10, "num_boxes": 25, "mean_confidence": 0.92},
        {"frame_index": 20, "num_boxes": 30, "mean_confidence": 0.65},  # Low confidence
        {"frame_index": 30, "num_boxes": 5, "mean_confidence": 0.95},  # Too few boxes
    ]

    result = select_reference_frame_simple(ocr_data, min_ocr_boxes=10, min_confidence=0.70)

    # Only frame 10 meets criteria
    assert result == 10


@pytest.mark.unit
def test_select_reference_frame_simple_no_candidates():
    """Test simplified selection returns None when no candidates."""
    ocr_data = [
        {"frame_index": 10, "num_boxes": 5, "mean_confidence": 0.60},
    ]

    result = select_reference_frame_simple(ocr_data, min_ocr_boxes=10, min_confidence=0.70)

    assert result is None


@pytest.mark.unit
def test_get_reference_frame_stats(test_db):
    """Test getting frame statistics."""
    stats = get_reference_frame_stats(test_db)

    assert stats["total_frames"] == 5  # 5 frames with OCR data
    assert stats["frames_with_ocr"] == 5
    assert stats["max_ocr_boxes"] == 30
    assert stats["mean_ocr_boxes"] == pytest.approx((25 + 30 + 15 + 5 + 8) / 5, rel=0.01)
    assert stats["max_confidence"] == pytest.approx(0.95, rel=0.01)
    assert stats["frames_above_threshold"] == 3  # Frames 10, 20, 30 have >= 10 boxes


@pytest.mark.unit
def test_get_all_frame_candidates(test_db):
    """Test getting all frame candidates."""
    frames = get_all_frame_candidates(test_db, min_ocr_boxes=10)

    # Should get frames 10, 20, 30 (>= 10 boxes)
    assert len(frames) == 3
    assert all(f["num_boxes"] >= 10 for f in frames)

    # Should be sorted by num_boxes descending
    assert frames[0]["frame_index"] == 20  # 30 boxes
    assert frames[1]["frame_index"] == 10  # 25 boxes
    assert frames[2]["frame_index"] == 30  # 15 boxes


@pytest.mark.unit
def test_get_all_frame_candidates_with_confidence_filter(test_db):
    """Test getting frame candidates with confidence filter."""
    frames = get_all_frame_candidates(test_db, min_ocr_boxes=1, min_confidence=0.90)

    # Should get frames 10 (0.92), 30 (0.95), 50 (0.90)
    assert len(frames) == 3
    assert all(f["mean_confidence"] >= 0.90 for f in frames)


@pytest.mark.unit
def test_reference_frame_contains_ocr_boxes(test_db):
    """Test that selected reference frame contains actual OCR box data."""
    result = select_reference_frame(test_db)

    assert result is not None
    assert len(result.ocr_boxes) > 0

    # Check structure of OCR boxes
    box = result.ocr_boxes[0]
    assert "text" in box
    assert "confidence" in box
    assert "x" in box
    assert "y" in box
    assert "width" in box
    assert "height" in box

    # Verify confidence matches expected value (frame 30 with conf 0.95)
    assert box["confidence"] == pytest.approx(0.95, rel=0.01)


@pytest.mark.unit
def test_empty_database():
    """Test selection with empty database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "empty.db"
        conn = sqlite3.connect(db_path)

        # Create table but no data
        conn.execute(
            """
            CREATE TABLE full_frame_ocr (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                confidence REAL NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL
            )
        """
        )
        conn.commit()
        conn.close()

        result = select_reference_frame(db_path)
        assert result is None

        stats = get_reference_frame_stats(db_path)
        assert stats["total_frames"] == 0
        assert stats["max_ocr_boxes"] == 0
