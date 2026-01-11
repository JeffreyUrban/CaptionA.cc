"""Tests for OcrRepository."""

import sqlite3

import pytest

from app.repositories.ocr import OcrRepository


@pytest.fixture
def repo(ocr_db_connection: sqlite3.Connection) -> OcrRepository:
    """Create a repository with empty database."""
    return OcrRepository(ocr_db_connection)


@pytest.fixture
def seeded_repo(seeded_ocr_db_connection: sqlite3.Connection) -> OcrRepository:
    """Create a repository with seeded data."""
    return OcrRepository(seeded_ocr_db_connection)


class TestListDetections:
    """Tests for list_detections method."""

    def test_list_detections_empty(self, repo: OcrRepository):
        """Should return empty list when no detections exist."""
        detections = repo.list_detections()
        assert len(detections) == 0

    def test_list_detections_all(self, seeded_repo: OcrRepository):
        """Should return all detections."""
        detections = seeded_repo.list_detections()
        assert len(detections) == 7

    def test_list_detections_by_frame(self, seeded_repo: OcrRepository):
        """Should filter by frame index."""
        detections = seeded_repo.list_detections(frame_index=0)
        assert len(detections) == 2
        assert all(d.frameIndex == 0 for d in detections)

    def test_list_detections_with_limit(self, seeded_repo: OcrRepository):
        """Should respect limit parameter."""
        detections = seeded_repo.list_detections(limit=3)
        assert len(detections) == 3

    def test_list_detections_with_offset(self, seeded_repo: OcrRepository):
        """Should respect offset parameter."""
        all_detections = seeded_repo.list_detections()
        offset_detections = seeded_repo.list_detections(limit=3, offset=2)
        assert len(offset_detections) == 3
        assert offset_detections[0].id == all_detections[2].id


class TestGetDetection:
    """Tests for get_detection method."""

    def test_get_detection_exists(self, seeded_repo: OcrRepository):
        """Should return detection by ID."""
        detection = seeded_repo.get_detection(1)
        assert detection is not None
        assert detection.id == 1
        assert detection.text == "Hello"
        assert detection.frameIndex == 0
        assert detection.boxIndex == 0
        assert detection.confidence == 0.95

    def test_get_detection_has_bbox(self, seeded_repo: OcrRepository):
        """Should include bounding box in detection."""
        detection = seeded_repo.get_detection(1)
        assert detection is not None
        assert detection.bbox is not None
        assert detection.bbox.left == 100
        assert detection.bbox.top == 200
        assert detection.bbox.right == 200
        assert detection.bbox.bottom == 250

    def test_get_detection_not_found(self, seeded_repo: OcrRepository):
        """Should return None when detection doesn't exist."""
        detection = seeded_repo.get_detection(999)
        assert detection is None


class TestGetFrameOcr:
    """Tests for get_frame_ocr method."""

    def test_get_frame_ocr_exists(self, seeded_repo: OcrRepository):
        """Should return all detections for a frame."""
        frame_result = seeded_repo.get_frame_ocr(0)
        assert frame_result is not None
        assert frame_result.frameIndex == 0
        assert frame_result.totalDetections == 2
        assert len(frame_result.detections) == 2
        # Check ordering by box_index
        assert frame_result.detections[0].boxIndex == 0
        assert frame_result.detections[1].boxIndex == 1

    def test_get_frame_ocr_not_found(self, seeded_repo: OcrRepository):
        """Should return None when frame has no OCR data."""
        frame_result = seeded_repo.get_frame_ocr(999)
        assert frame_result is None


class TestListFramesWithOcr:
    """Tests for list_frames_with_ocr method."""

    def test_list_frames_all(self, seeded_repo: OcrRepository):
        """Should return all frames with OCR data."""
        frames = seeded_repo.list_frames_with_ocr()
        assert len(frames) == 4  # frames 0, 1, 2, 5
        frame_indices = [f.frameIndex for f in frames]
        assert frame_indices == [0, 1, 2, 5]

    def test_list_frames_in_range(self, seeded_repo: OcrRepository):
        """Should filter by frame range."""
        frames = seeded_repo.list_frames_with_ocr(start_frame=1, end_frame=3)
        assert len(frames) == 2  # frames 1, 2
        frame_indices = [f.frameIndex for f in frames]
        assert frame_indices == [1, 2]

    def test_list_frames_with_limit(self, seeded_repo: OcrRepository):
        """Should respect limit parameter."""
        frames = seeded_repo.list_frames_with_ocr(limit=2)
        assert len(frames) == 2


class TestGetDetectionsInRange:
    """Tests for get_detections_in_range method."""

    def test_get_detections_in_range(self, seeded_repo: OcrRepository):
        """Should return detections within frame range."""
        detections = seeded_repo.get_detections_in_range(0, 1)
        assert len(detections) == 4  # frames 0 and 1, 2 detections each

    def test_get_detections_in_range_with_limit(self, seeded_repo: OcrRepository):
        """Should respect limit parameter."""
        detections = seeded_repo.get_detections_in_range(0, 2, limit=3)
        assert len(detections) == 3


class TestSearchText:
    """Tests for search_text method."""

    def test_search_text_found(self, seeded_repo: OcrRepository):
        """Should find detections containing search text."""
        detections = seeded_repo.search_text("Hello")
        assert len(detections) == 2  # "Hello" appears in frame 0 and 2

    def test_search_text_case_insensitive(self, seeded_repo: OcrRepository):
        """Should be case-insensitive."""
        detections = seeded_repo.search_text("hello")
        assert len(detections) == 2

    def test_search_text_partial(self, seeded_repo: OcrRepository):
        """Should match partial text."""
        detections = seeded_repo.search_text("ell")
        assert len(detections) == 2  # matches "Hello"

    def test_search_text_not_found(self, seeded_repo: OcrRepository):
        """Should return empty when no matches."""
        detections = seeded_repo.search_text("xyz123")
        assert len(detections) == 0

    def test_search_text_with_limit(self, seeded_repo: OcrRepository):
        """Should respect limit parameter."""
        detections = seeded_repo.search_text("Hello", limit=1)
        assert len(detections) == 1


class TestGetStats:
    """Tests for get_stats method."""

    def test_get_stats_empty(self, repo: OcrRepository):
        """Should return zeros for empty database."""
        stats = repo.get_stats()
        assert stats["total_detections"] == 0
        assert stats["frames_with_ocr"] == 0
        assert stats["avg_detections_per_frame"] == 0.0

    def test_get_stats_with_data(self, seeded_repo: OcrRepository):
        """Should return correct statistics."""
        stats = seeded_repo.get_stats()
        assert stats["total_detections"] == 7
        assert stats["frames_with_ocr"] == 4
        assert stats["avg_detections_per_frame"] == 1.75


class TestGetFrameIndices:
    """Tests for get_frame_indices method."""

    def test_get_frame_indices_empty(self, repo: OcrRepository):
        """Should return empty list for empty database."""
        indices = repo.get_frame_indices()
        assert len(indices) == 0

    def test_get_frame_indices_with_data(self, seeded_repo: OcrRepository):
        """Should return all frame indices with OCR data."""
        indices = seeded_repo.get_frame_indices()
        assert indices == [0, 1, 2, 5]


class TestCountDetections:
    """Tests for count_detections method."""

    def test_count_all_detections(self, seeded_repo: OcrRepository):
        """Should count all detections."""
        count = seeded_repo.count_detections()
        assert count == 7

    def test_count_detections_by_frame(self, seeded_repo: OcrRepository):
        """Should count detections for a specific frame."""
        count = seeded_repo.count_detections(frame_index=0)
        assert count == 2

    def test_count_detections_empty_frame(self, seeded_repo: OcrRepository):
        """Should return 0 for frame without detections."""
        count = seeded_repo.count_detections(frame_index=999)
        assert count == 0
