"""Tests for database operations."""

import sqlite3
import tempfile
from pathlib import Path

import pytest

from caption_text.database import (
    get_caption_by_frames,
    get_captions_needing_text,
    get_database_path,
    get_layout_config,
    update_caption_text,
)


@pytest.fixture
def mock_db():
    """Create a temporary database with test data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "annotations.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Create tables
        cursor.execute("""
            CREATE TABLE captions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_frame_index INTEGER NOT NULL,
                end_frame_index INTEGER NOT NULL,
                boundary_state TEXT NOT NULL DEFAULT 'predicted',
                boundary_pending INTEGER NOT NULL DEFAULT 0,
                text TEXT,
                text_pending INTEGER NOT NULL DEFAULT 0,
                text_status TEXT,
                text_notes TEXT,
                text_ocr_combined TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        cursor.execute("""
            CREATE TABLE video_layout_config (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                frame_width INTEGER NOT NULL,
                frame_height INTEGER NOT NULL,
                crop_left INTEGER NOT NULL,
                crop_top INTEGER NOT NULL,
                crop_right INTEGER NOT NULL,
                crop_bottom INTEGER NOT NULL,
                vertical_position INTEGER,
                box_height INTEGER,
                anchor_type TEXT,
                anchor_position INTEGER,
                crop_bounds_version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # Insert test data
        cursor.execute("""
            INSERT INTO captions (start_frame_index, end_frame_index, text, text_pending)
            VALUES (100, 150, NULL, 0)
        """)
        cursor.execute("""
            INSERT INTO captions (start_frame_index, end_frame_index, text, text_pending)
            VALUES (200, 250, 'existing text', 1)
        """)

        cursor.execute("""
            INSERT INTO video_layout_config
            (id, frame_width, frame_height, crop_left, crop_top, crop_right, crop_bottom,
             vertical_position, box_height, anchor_type, anchor_position)
            VALUES (1, 1920, 1080, 0, 800, 1920, 1080, 900, 50, 'center', 960)
        """)

        conn.commit()
        conn.close()

        yield db_path


def test_get_database_path():
    """Test database path resolution."""
    video_dir = Path("/path/to/video")
    expected = Path("/path/to/video/annotations.db")
    assert get_database_path(video_dir) == expected


def test_get_layout_config(mock_db):
    """Test layout config retrieval."""
    config = get_layout_config(mock_db)

    assert config["frame_width"] == 1920
    assert config["frame_height"] == 1080
    assert config["anchor_type"] == "center"
    assert config["anchor_position"] == 960
    assert config["box_height"] == 50


def test_get_captions_needing_text(mock_db):
    """Test finding captions that need text."""
    captions = get_captions_needing_text(mock_db)

    assert len(captions) == 2
    # First has NULL text
    assert captions[0]["text"] is None
    # Second has text_pending=1
    assert captions[1]["text_pending"] == 1


def test_get_caption_by_frames(mock_db):
    """Test finding caption by frame range."""
    caption = get_caption_by_frames(mock_db, 100, 150)

    assert caption is not None
    assert caption["start_frame_index"] == 100
    assert caption["end_frame_index"] == 150


def test_update_caption_text(mock_db):
    """Test updating caption text."""
    # Get first caption
    caption = get_caption_by_frames(mock_db, 100, 150)
    assert caption is not None, "Caption should exist"
    caption_id = caption["id"]

    # Update text
    update_caption_text(
        db_path=mock_db,
        caption_id=caption_id,
        text="new caption text",
        text_status="valid_caption",
        text_notes="test update",
        clear_pending=True,
    )

    # Verify update
    updated = get_caption_by_frames(mock_db, 100, 150)
    assert updated is not None, "Updated caption should exist"
    assert updated["text"] == "new caption text"
    assert updated["text_status"] == "valid_caption"
    assert updated["text_notes"] == "test update"
    assert updated["text_pending"] == 0
