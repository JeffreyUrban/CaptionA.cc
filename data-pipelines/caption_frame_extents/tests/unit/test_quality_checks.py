"""Unit tests for caption frame extents prediction quality checks."""

from caption_frame_extents.inference.quality_checks import (
    check_caption_frame_extents_coherence,
    run_quality_checks,
)


class TestCheckCaptionFrameExtentsCoherence:
    """Tests for check_caption_frame_extents_coherence function."""

    def test_empty_caption_frame_extents_is_coherent(self):
        """Empty list should be considered coherent."""
        result = check_caption_frame_extents_coherence([])
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_single_caption_frame_extent_is_coherent(self):
        """Single caption frame extent should be considered coherent."""
        caption_frame_extents = [{"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"}]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_spaced_different_predictions_are_coherent(self):
        """Different predictions with proper gaps should be coherent."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
            {"frame1_index": 25, "frame2_index": 26, "predicted_label": "different"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_consecutive_different_with_no_gap_is_incoherent(self):
        """Two consecutive 'different' predictions with no gap should be flagged."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is False
        assert len(result["issues"]) == 1
        assert result["issues"][0]["type"] == "consecutive_caption_frame_extents"

    def test_consecutive_different_with_minimal_gap_is_incoherent(self):
        """Two 'different' predictions with gap < 2 should be flagged."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "different"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is False
        assert len(result["issues"]) == 1

    def test_consecutive_different_with_gap_of_two_is_coherent(self):
        """Two 'different' predictions with gap >= 2 should be coherent."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 3, "frame2_index": 4, "predicted_label": "different"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_same_predictions_are_ignored(self):
        """'same' predictions should not trigger coherence issues."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "same"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "same"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_mixed_labels_with_valid_sequence(self):
        """Mixed labels with valid spacing should be coherent."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "same"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is True

    def test_empty_labels_are_ignored(self):
        """Empty-related labels should not trigger coherence issues."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "empty_empty"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "empty_valid"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "valid_empty"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is True

    def test_multiple_consecutive_issues(self):
        """Multiple consecutive 'different' pairs should each be flagged."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "different"},
        ]
        result = check_caption_frame_extents_coherence(caption_frame_extents)
        assert result["coherent"] is False
        assert len(result["issues"]) == 2


class TestRunQualityChecks:
    """Tests for run_quality_checks function."""

    def test_empty_caption_frame_extents_perfect_pass_rate(self):
        """Empty caption frame extents should have 100% pass rate."""
        from pathlib import Path

        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            caption_frame_extents=[],
        )
        assert result["pass_rate"] == 1.0
        assert result["flagged_caption_frame_extents"] == []
        assert result["quality_stats"]["total_caption_frame_extents"] == 0

    def test_all_valid_caption_frame_extents_perfect_pass_rate(self):
        """All valid caption_frame_extents should have 100% pass rate."""
        from pathlib import Path

        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
        ]
        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            caption_frame_extents=caption_frame_extents,
        )
        assert result["pass_rate"] == 1.0
        assert result["flagged_caption_frame_extents"] == []
        assert result["quality_stats"]["total_caption_frame_extents"] == 2

    def test_flagged_caption_frame_extents_reduce_pass_rate(self):
        """Flagged caption frame extents should reduce pass rate."""
        from pathlib import Path

        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
        ]
        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            caption_frame_extents=caption_frame_extents,
        )
        assert result["pass_rate"] < 1.0
        assert len(result["flagged_caption_frame_extents"]) > 0
        assert result["quality_stats"]["sequence_issues"] > 0

    def test_flagged_caption_frame_extents_contain_original_data(self):
        """Flagged caption frame extents should preserve original data plus flags."""
        from pathlib import Path

        caption_frame_extents = [
            {
                "frame1_index": 0,
                "frame2_index": 1,
                "predicted_label": "different",
                "confidence": 0.95,
            },
            {
                "frame1_index": 1,
                "frame2_index": 2,
                "predicted_label": "different",
                "confidence": 0.87,
            },
        ]
        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            caption_frame_extents=caption_frame_extents,
        )
        for flagged in result["flagged_caption_frame_extents"]:
            assert "frame1_index" in flagged
            assert "frame2_index" in flagged
            assert "predicted_label" in flagged
            assert "confidence" in flagged
            assert "flags" in flagged
            assert isinstance(flagged["flags"], list)

    def test_coherence_check_included_in_result(self):
        """Coherence check result should be included."""
        from pathlib import Path

        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
        ]
        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            boundaries=boundaries,
        )
        assert "coherence_check" in result
        assert "coherent" in result["coherence_check"]
        assert "issues" in result["coherence_check"]

    def test_unused_parameters_dont_affect_result(self):
        """OCR confidence threshold should not affect result (kept for API compat)."""
        from pathlib import Path

        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
        ]
        result1 = run_quality_checks(
            video_db_path=Path("/fake/path"),
            boundaries=boundaries,
            ocr_confidence_min=0.5,
        )
        result2 = run_quality_checks(
            video_db_path=Path("/fake/path"),
            boundaries=boundaries,
            ocr_confidence_min=0.9,
        )
        assert result1["pass_rate"] == result2["pass_rate"]
