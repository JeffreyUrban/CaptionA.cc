"""Tests for CaptionRepository."""

import sqlite3
from pathlib import Path

import pytest

from app.models.captions import (
    CaptionFrameExtentsState,
    CaptionCreate,
    CaptionTextUpdate,
    CaptionUpdate,
)
from app.repositories.captions import CaptionRepository


@pytest.fixture
def db_connection(captions_db: Path) -> sqlite3.Connection:
    """Create a database connection for testing."""
    conn = sqlite3.connect(str(captions_db))
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def seeded_db_connection(seeded_captions_db: Path) -> sqlite3.Connection:
    """Create a database connection with seeded data."""
    conn = sqlite3.connect(str(seeded_captions_db))
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def repo(db_connection: sqlite3.Connection) -> CaptionRepository:
    """Create a repository with empty database."""
    return CaptionRepository(db_connection)


@pytest.fixture
def seeded_repo(seeded_db_connection: sqlite3.Connection) -> CaptionRepository:
    """Create a repository with seeded data."""
    return CaptionRepository(seeded_db_connection)


class TestListCaptions:
    """Tests for list_captions method."""

    def test_list_captions_in_range(self, seeded_repo: CaptionRepository):
        """Should return captions overlapping the frame range."""
        captions = seeded_repo.list_captions(0, 150)
        assert len(captions) == 2
        assert captions[0].id == 1
        assert captions[1].id == 2

    def test_list_captions_empty_range(self, seeded_repo: CaptionRepository):
        """Should return empty list when no captions in range."""
        captions = seeded_repo.list_captions(1000, 2000)
        assert len(captions) == 0

    def test_list_captions_workable_only(self, seeded_repo: CaptionRepository):
        """Should filter to only gaps and pending captions."""
        captions = seeded_repo.list_captions(0, 500, workable_only=True)
        assert len(captions) == 2
        # Caption 2 is pending, Caption 3 is gap
        ids = {c.id for c in captions}
        assert ids == {2, 3}

    def test_list_captions_with_limit(self, seeded_repo: CaptionRepository):
        """Should respect limit parameter."""
        captions = seeded_repo.list_captions(0, 500, limit=2)
        assert len(captions) == 2


class TestGetCaption:
    """Tests for get_caption method."""

    def test_get_caption_exists(self, seeded_repo: CaptionRepository):
        """Should return caption by ID."""
        caption = seeded_repo.get_caption(1)
        assert caption is not None
        assert caption.id == 1
        assert caption.startFrameIndex == 0
        assert caption.endFrameIndex == 100
        assert caption.text == "First caption"

    def test_get_caption_not_found(self, seeded_repo: CaptionRepository):
        """Should return None when caption doesn't exist."""
        caption = seeded_repo.get_caption(999)
        assert caption is None


class TestCreateCaption:
    """Tests for create_caption method."""

    def test_create_caption(self, repo: CaptionRepository):
        """Should create a new caption."""
        input_data = CaptionCreate(
            startFrameIndex=0,
            endFrameIndex=100,
            captionFrameExtentsState=CaptionFrameExtentsState.PREDICTED,
            text="Test caption",
        )
        caption = repo.create_caption(input_data)

        assert caption.id is not None
        assert caption.startFrameIndex == 0
        assert caption.endFrameIndex == 100
        assert caption.text == "Test caption"
        assert caption.captionFrameExtentsState == CaptionFrameExtentsState.PREDICTED

    def test_create_gap_caption(self, repo: CaptionRepository):
        """Should create a gap caption without image regen flag."""
        input_data = CaptionCreate(
            startFrameIndex=0,
            endFrameIndex=50,
            captionFrameExtentsState=CaptionFrameExtentsState.GAP,
        )
        caption = repo.create_caption(input_data)

        assert caption.captionFrameExtentsState == CaptionFrameExtentsState.GAP
        assert caption.imageNeedsRegen is False


class TestUpdateCaptionWithOverlapResolution:
    """Tests for update_caption_with_overlap_resolution method."""

    def test_update_caption_frame_extents_no_overlap(
        self, seeded_repo: CaptionRepository
    ):
        """Should update caption frame extents without affecting other captions."""
        result = seeded_repo.update_caption_with_overlap_resolution(
            1,
            CaptionUpdate(
                startFrameIndex=10,
                endFrameIndex=90,
                captionFrameExtentsState=CaptionFrameExtentsState.CONFIRMED,
            ),
        )

        assert result.caption.startFrameIndex == 10
        assert result.caption.endFrameIndex == 90
        assert (
            result.caption.captionFrameExtentsState
            == CaptionFrameExtentsState.CONFIRMED
        )
        # Should create gaps for uncovered ranges
        assert len(result.createdGaps) == 2  # [0-9] and [91-100]

    def test_update_caption_frame_extents_delete_contained(
        self, seeded_repo: CaptionRepository
    ):
        """Should delete captions completely contained in new range."""
        # Expand caption 1 to completely contain caption 2
        result = seeded_repo.update_caption_with_overlap_resolution(
            1,
            CaptionUpdate(
                startFrameIndex=0,
                endFrameIndex=250,  # Contains caption 2 (101-200)
                captionFrameExtentsState=CaptionFrameExtentsState.CONFIRMED,
            ),
        )

        assert result.caption.endFrameIndex == 250
        assert 2 in result.deletedCaptions

    def test_update_caption_frame_extents_trim_overlap(
        self, seeded_repo: CaptionRepository
    ):
        """Should trim overlapping captions."""
        # Expand caption 1 to partially overlap caption 2
        result = seeded_repo.update_caption_with_overlap_resolution(
            1,
            CaptionUpdate(
                startFrameIndex=0,
                endFrameIndex=150,  # Overlaps with caption 2 (101-200)
                captionFrameExtentsState=CaptionFrameExtentsState.CONFIRMED,
            ),
        )

        assert result.caption.endFrameIndex == 150
        # Caption 2 should be trimmed
        assert len(result.modifiedCaptions) == 1
        assert result.modifiedCaptions[0].startFrameIndex == 151

    def test_update_not_found(self, seeded_repo: CaptionRepository):
        """Should raise error when caption doesn't exist."""
        with pytest.raises(ValueError, match="not found"):
            seeded_repo.update_caption_with_overlap_resolution(
                999,
                CaptionUpdate(
                    startFrameIndex=0,
                    endFrameIndex=100,
                    captionFrameExtentsState=CaptionFrameExtentsState.CONFIRMED,
                ),
            )


class TestUpdateCaptionText:
    """Tests for update_caption_text method."""

    def test_update_text(self, seeded_repo: CaptionRepository):
        """Should update caption text."""
        caption = seeded_repo.update_caption_text(
            2,
            CaptionTextUpdate(text="Updated text"),
        )

        assert caption is not None
        assert caption.text == "Updated text"
        assert caption.textPending is False

    def test_update_text_with_status(self, seeded_repo: CaptionRepository):
        """Should update text with status and notes."""
        from app.models.captions import TextStatus

        caption = seeded_repo.update_caption_text(
            2,
            CaptionTextUpdate(
                text="Caption text",
                textStatus=TextStatus.VALID_CAPTION,
                textNotes="Verified",
            ),
        )

        assert caption is not None
        assert caption.text == "Caption text"
        assert caption.textStatus == "valid_caption"
        assert caption.textNotes == "Verified"

    def test_update_text_not_found(self, seeded_repo: CaptionRepository):
        """Should return None when caption doesn't exist."""
        caption = seeded_repo.update_caption_text(
            999,
            CaptionTextUpdate(text="Some text"),
        )
        assert caption is None


class TestDeleteCaption:
    """Tests for delete_caption method."""

    def test_delete_caption(self, seeded_repo: CaptionRepository):
        """Should delete a caption."""
        result = seeded_repo.delete_caption(1)
        assert result is True

        # Verify it's gone
        caption = seeded_repo.get_caption(1)
        assert caption is None

    def test_delete_caption_not_found(self, seeded_repo: CaptionRepository):
        """Should return False when caption doesn't exist."""
        result = seeded_repo.delete_caption(999)
        assert result is False


class TestGapMerging:
    """Tests for gap merging logic."""

    def test_create_gap_merges_adjacent(self, repo: CaptionRepository):
        """Should merge adjacent gaps when creating new gap."""
        # Create initial gaps
        repo.create_caption(
            CaptionCreate(
                startFrameIndex=0,
                endFrameIndex=50,
                captionFrameExtentsState=CaptionFrameExtentsState.GAP,
            )
        )
        repo.create_caption(
            CaptionCreate(
                startFrameIndex=100,
                endFrameIndex=150,
                captionFrameExtentsState=CaptionFrameExtentsState.GAP,
            )
        )

        # Create caption in between and then shrink it to create a gap that merges
        caption = repo.create_caption(
            CaptionCreate(
                startFrameIndex=51,
                endFrameIndex=99,
                captionFrameExtentsState=CaptionFrameExtentsState.CONFIRMED,
            )
        )

        # Now shrink the caption, which should create gaps that merge with existing ones
        repo.update_caption_with_overlap_resolution(
            caption.id,
            CaptionUpdate(
                startFrameIndex=60,
                endFrameIndex=90,
                captionFrameExtentsState=CaptionFrameExtentsState.CONFIRMED,
            ),
        )

        # Check that gaps were created/merged
        all_captions = repo.list_captions(0, 200)
        gaps = [
            c
            for c in all_captions
            if c.captionFrameExtentsState == CaptionFrameExtentsState.GAP
        ]

        # Should have merged gaps: [0-59] and [91-150]
        assert len(gaps) == 2
