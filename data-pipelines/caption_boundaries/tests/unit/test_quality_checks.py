"""Unit tests for boundary prediction quality checks."""

from caption_boundaries.inference.quality_checks import (
    check_boundary_coherence,
    run_quality_checks,
)


class TestCheckBoundaryCoherence:
    """Tests for check_boundary_coherence function."""

    def test_empty_boundaries_is_coherent(self):
        """Empty list should be considered coherent."""
        result = check_boundary_coherence([])
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_single_boundary_is_coherent(self):
        """Single boundary should be considered coherent."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"}
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_spaced_different_predictions_are_coherent(self):
        """Different predictions with proper gaps should be coherent."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
            {"frame1_index": 25, "frame2_index": 26, "predicted_label": "different"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_consecutive_different_with_no_gap_is_incoherent(self):
        """Two consecutive 'different' predictions with no gap should be flagged."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is False
        assert len(result["issues"]) == 1
        assert result["issues"][0]["type"] == "consecutive_boundaries"

    def test_consecutive_different_with_minimal_gap_is_incoherent(self):
        """Two 'different' predictions with gap < 2 should be flagged."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "different"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is False
        assert len(result["issues"]) == 1

    def test_consecutive_different_with_gap_of_two_is_coherent(self):
        """Two 'different' predictions with gap >= 2 should be coherent."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 3, "frame2_index": 4, "predicted_label": "different"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_same_predictions_are_ignored(self):
        """'same' predictions should not trigger coherence issues."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "same"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "same"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is True
        assert result["issues"] == []

    def test_mixed_labels_with_valid_sequence(self):
        """Mixed labels with valid spacing should be coherent."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "same"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is True

    def test_empty_labels_are_ignored(self):
        """Empty-related labels should not trigger coherence issues."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "empty_empty"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "empty_valid"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "valid_empty"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is True

    def test_multiple_consecutive_issues(self):
        """Multiple consecutive 'different' pairs should each be flagged."""
        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "different"},
        ]
        result = check_boundary_coherence(boundaries)
        assert result["coherent"] is False
        assert len(result["issues"]) == 2


class TestRunQualityChecks:
    """Tests for run_quality_checks function."""

    def test_empty_boundaries_perfect_pass_rate(self):
        """Empty boundaries should have 100% pass rate."""
        from pathlib import Path

        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            boundaries=[],
        )
        assert result["pass_rate"] == 1.0
        assert result["flagged_boundaries"] == []
        assert result["quality_stats"]["total_boundaries"] == 0

    def test_all_valid_boundaries_perfect_pass_rate(self):
        """All valid boundaries should have 100% pass rate."""
        from pathlib import Path

        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
        ]
        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            boundaries=boundaries,
        )
        assert result["pass_rate"] == 1.0
        assert result["flagged_boundaries"] == []
        assert result["quality_stats"]["total_boundaries"] == 2

    def test_flagged_boundaries_reduce_pass_rate(self):
        """Flagged boundaries should reduce pass rate."""
        from pathlib import Path

        boundaries = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
        ]
        result = run_quality_checks(
            video_db_path=Path("/fake/path"),
            boundaries=boundaries,
        )
        assert result["pass_rate"] < 1.0
        assert len(result["flagged_boundaries"]) > 0
        assert result["quality_stats"]["sequence_issues"] > 0

    def test_flagged_boundaries_contain_original_data(self):
        """Flagged boundaries should preserve original data plus flags."""
        from pathlib import Path

        boundaries = [
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
            boundaries=boundaries,
        )
        for flagged in result["flagged_boundaries"]:
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
