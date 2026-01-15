"""Tests for LayoutRepository."""

import sqlite3

import pytest

from app.models.layout import (
    AnalysisResultsUpdate,
    BoxLabel,
    BoxLabelCreate,
    LabelSource,
    SelectionMode,
    VideoLayoutConfigInit,
    VideoLayoutConfigUpdate,
    VideoPreferencesUpdate,
)
from app.repositories.layout import LayoutRepository


@pytest.fixture
def repo(layout_db_connection: sqlite3.Connection) -> LayoutRepository:
    """Create a repository with empty database."""
    return LayoutRepository(layout_db_connection)


@pytest.fixture
def seeded_repo(seeded_layout_db_connection: sqlite3.Connection) -> LayoutRepository:
    """Create a repository with seeded data."""
    return LayoutRepository(seeded_layout_db_connection)


class TestVideoLayoutConfig:
    """Tests for video layout config operations."""

    def test_get_layout_config_not_found(self, repo: LayoutRepository):
        """Should return None when config doesn't exist."""
        config = repo.get_layout_config()
        assert config is None

    def test_get_layout_config_exists(self, seeded_repo: LayoutRepository):
        """Should return config when it exists."""
        config = seeded_repo.get_layout_config()
        assert config is not None
        assert config.frameWidth == 1920
        assert config.frameHeight == 1080
        assert config.cropLeft == 10
        assert config.cropTop == 20
        assert config.cropRight == 30
        assert config.cropBottom == 40
        assert config.selectionMode == SelectionMode.MANUAL

    def test_init_layout_config(self, repo: LayoutRepository):
        """Should create new config with frame dimensions."""
        config = repo.init_layout_config(
            VideoLayoutConfigInit(frameWidth=1280, frameHeight=720)
        )
        assert config.frameWidth == 1280
        assert config.frameHeight == 720
        assert config.cropLeft == 0
        assert config.cropTop == 0
        assert config.selectionMode == SelectionMode.DISABLED

    def test_init_layout_config_updates_existing(self, seeded_repo: LayoutRepository):
        """Should update existing config with new frame dimensions."""
        config = seeded_repo.init_layout_config(
            VideoLayoutConfigInit(frameWidth=1280, frameHeight=720)
        )
        assert config.frameWidth == 1280
        assert config.frameHeight == 720
        # Should keep existing crop values
        assert config.cropLeft == 10

    def test_update_layout_config_crop_region(self, seeded_repo: LayoutRepository):
        """Should update crop region and increment version."""
        original = seeded_repo.get_layout_config()
        original_version = original.cropRegionVersion

        config = seeded_repo.update_layout_config(
            VideoLayoutConfigUpdate(cropLeft=50, cropTop=60)
        )
        assert config.cropLeft == 50
        assert config.cropTop == 60
        assert config.cropRight == 30  # Unchanged
        assert config.cropRegionVersion == original_version + 1

    def test_update_layout_config_selection(self, seeded_repo: LayoutRepository):
        """Should update selection region."""
        config = seeded_repo.update_layout_config(
            VideoLayoutConfigUpdate(
                selectionLeft=100,
                selectionTop=200,
                selectionRight=300,
                selectionBottom=400,
                selectionMode=SelectionMode.AUTO,
            )
        )
        assert config.selectionLeft == 100
        assert config.selectionTop == 200
        assert config.selectionRight == 300
        assert config.selectionBottom == 400
        assert config.selectionMode == SelectionMode.AUTO

    def test_update_analysis_results(self, seeded_repo: LayoutRepository):
        """Should update analysis results from ML model."""
        config = seeded_repo.update_analysis_results(
            AnalysisResultsUpdate(
                verticalPosition=0.85,
                verticalStd=0.02,
                boxHeight=0.1,
                anchorType="bottom",
                analysisModelVersion="v1.0.0",
            )
        )
        assert config.verticalPosition == 0.85
        assert config.verticalStd == 0.02
        assert config.boxHeight == 0.1
        assert config.anchorType == "bottom"
        assert config.analysisModelVersion == "v1.0.0"


class TestBoxLabels:
    """Tests for box label operations."""

    def test_list_box_labels_empty(self, repo: LayoutRepository):
        """Should return empty list when no labels exist."""
        labels = repo.list_box_labels()
        assert len(labels) == 0

    def test_list_box_labels_all(self, seeded_repo: LayoutRepository):
        """Should return all labels."""
        labels = seeded_repo.list_box_labels()
        assert len(labels) == 4

    def test_list_box_labels_by_frame(self, seeded_repo: LayoutRepository):
        """Should filter by frame index."""
        labels = seeded_repo.list_box_labels(frame_index=0)
        assert len(labels) == 2
        assert all(label.frameIndex == 0 for label in labels)

    def test_list_box_labels_by_source(self, seeded_repo: LayoutRepository):
        """Should filter by label source."""
        labels = seeded_repo.list_box_labels(label_source=LabelSource.USER)
        assert len(labels) == 2
        assert all(label.labelSource == LabelSource.USER for label in labels)

    def test_list_box_labels_with_limit(self, seeded_repo: LayoutRepository):
        """Should respect limit parameter."""
        labels = seeded_repo.list_box_labels(limit=2)
        assert len(labels) == 2

    def test_get_box_label_exists(self, seeded_repo: LayoutRepository):
        """Should return label by ID."""
        label = seeded_repo.get_box_label(1)
        assert label is not None
        assert label.id == 1
        assert label.frameIndex == 0
        assert label.boxIndex == 0
        assert label.label == BoxLabel.IN

    def test_get_box_label_not_found(self, seeded_repo: LayoutRepository):
        """Should return None when label doesn't exist."""
        label = seeded_repo.get_box_label(999)
        assert label is None

    def test_create_box_label(self, repo: LayoutRepository):
        """Should create a new box label."""
        label = repo.create_box_label(
            BoxLabelCreate(
                frameIndex=5,
                boxIndex=2,
                label=BoxLabel.IN,
                labelSource=LabelSource.USER,
            )
        )
        assert label.frameIndex == 5
        assert label.boxIndex == 2
        assert label.label == BoxLabel.IN
        assert label.labelSource == LabelSource.USER

    def test_create_box_label_upsert(self, seeded_repo: LayoutRepository):
        """Should update existing label on conflict."""
        # Frame 0, box 0, user already has 'in' label
        label = seeded_repo.create_box_label(
            BoxLabelCreate(
                frameIndex=0,
                boxIndex=0,
                label=BoxLabel.OUT,  # Change to OUT
                labelSource=LabelSource.USER,
            )
        )
        assert label.label == BoxLabel.OUT

        # Verify only one label exists for this position
        labels = seeded_repo.list_box_labels(frame_index=0)
        user_labels = [
            label
            for label in labels
            if label.labelSource == LabelSource.USER and label.boxIndex == 0
        ]
        assert len(user_labels) == 1

    def test_create_box_labels_batch(self, repo: LayoutRepository):
        """Should create multiple labels in a batch."""
        labels = repo.create_box_labels_batch(
            [
                BoxLabelCreate(frameIndex=0, boxIndex=0, label=BoxLabel.IN),
                BoxLabelCreate(frameIndex=0, boxIndex=1, label=BoxLabel.OUT),
                BoxLabelCreate(frameIndex=1, boxIndex=0, label=BoxLabel.IN),
            ]
        )
        assert len(labels) == 3

        # Verify all labels were created
        all_labels = repo.list_box_labels()
        assert len(all_labels) == 3

    def test_delete_box_label(self, seeded_repo: LayoutRepository):
        """Should delete a box label."""
        result = seeded_repo.delete_box_label(1)
        assert result is True

        # Verify it's gone
        label = seeded_repo.get_box_label(1)
        assert label is None

    def test_delete_box_label_not_found(self, seeded_repo: LayoutRepository):
        """Should return False when label doesn't exist."""
        result = seeded_repo.delete_box_label(999)
        assert result is False

    def test_delete_box_labels_by_source(self, seeded_repo: LayoutRepository):
        """Should delete all labels from a source."""
        count = seeded_repo.delete_box_labels_by_source(LabelSource.MODEL)
        assert count == 2

        # Verify model labels are gone
        labels = seeded_repo.list_box_labels(label_source=LabelSource.MODEL)
        assert len(labels) == 0

        # User labels should remain
        labels = seeded_repo.list_box_labels(label_source=LabelSource.USER)
        assert len(labels) == 2

    def test_delete_box_labels_for_frame(self, seeded_repo: LayoutRepository):
        """Should delete all labels for a frame."""
        count = seeded_repo.delete_box_labels_for_frame(0)
        assert count == 2

        # Verify frame 0 labels are gone
        labels = seeded_repo.list_box_labels(frame_index=0)
        assert len(labels) == 0


class TestVideoPreferences:
    """Tests for video preferences operations."""

    def test_get_preferences_creates_default(self, repo: LayoutRepository):
        """Should create default preferences if not exist."""
        preferences = repo.get_preferences()
        assert preferences.layoutApproved is False

    def test_get_preferences_exists(self, seeded_repo: LayoutRepository):
        """Should return existing preferences."""
        preferences = seeded_repo.get_preferences()
        assert preferences.layoutApproved is False

    def test_update_preferences(self, seeded_repo: LayoutRepository):
        """Should update preferences."""
        preferences = seeded_repo.update_preferences(
            VideoPreferencesUpdate(layoutApproved=True)
        )
        assert preferences.layoutApproved is True

        # Verify it persisted
        preferences = seeded_repo.get_preferences()
        assert preferences.layoutApproved is True
