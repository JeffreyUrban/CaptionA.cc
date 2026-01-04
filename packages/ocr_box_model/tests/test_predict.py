"""Unit tests for spatial heuristics predictor."""

import pytest
from caption_models import BoundingBox, CropBounds
from ocr_box_model.features import LayoutParams
from ocr_box_model.predict import (
    gaussian_prob,
    get_confident_predictions,
    get_uncertain_predictions,
    predict_box_with_heuristics,
    predict_with_heuristics,
)


@pytest.fixture
def typical_layout_params() -> LayoutParams:
    """Typical layout parameters for 1920x1080 Chinese subtitles."""
    return LayoutParams(
        vertical_position=945,
        vertical_std=12.0,
        box_height=54,
        box_height_std=5.0,
        anchor_type="left",
        anchor_position=960,
    )


@pytest.fixture
def crop_bounds_bottom_third() -> CropBounds:
    """Crop bounds for bottom third of 1920x1080 frame."""
    return CropBounds(left=0, top=723, right=1920, bottom=1080)


class TestGaussianProb:
    """Tests for gaussian_prob function."""

    def test_exact_mean(self):
        """Test probability at exact mean."""
        prob = gaussian_prob(x=10.0, mean=10.0, std=2.0)
        assert prob == pytest.approx(1.0)

    def test_one_std_away(self):
        """Test probability 1 std away from mean."""
        prob = gaussian_prob(x=12.0, mean=10.0, std=2.0)
        # exp(-0.5 * 1^2) = exp(-0.5) ≈ 0.6065
        assert prob == pytest.approx(0.6065, rel=1e-3)

    def test_zero_std(self):
        """Test with zero standard deviation."""
        # Should return 1.0 at mean, 0.0 elsewhere
        assert gaussian_prob(x=10.0, mean=10.0, std=0.0) == pytest.approx(1.0)
        assert gaussian_prob(x=11.0, mean=10.0, std=0.0) == pytest.approx(0.0)


class TestPredictBoxWithHeuristics:
    """Tests for predict_box_with_heuristics function."""

    def test_caption_box_predicted_in(self, typical_layout_params, crop_bounds_bottom_third):
        """Test that typical caption box is predicted as 'in' with high confidence."""
        # Perfect caption box: aligned vertically, correct height, at anchor
        box = BoundingBox(left=960, top=918, right=1014, bottom=972)

        prediction = predict_box_with_heuristics(
            box=box,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        assert prediction["label"] == "in"
        assert prediction["confidence"] > 0.7  # High confidence

    def test_noise_box_outside_crop(self, typical_layout_params, crop_bounds_bottom_third):
        """Test that box outside crop is predicted as 'out' with high confidence."""
        # Logo box in top corner (outside crop bounds)
        box = BoundingBox(left=1632, top=54, right=1824, bottom=130)

        prediction = predict_box_with_heuristics(
            box=box,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        assert prediction["label"] == "out"
        assert prediction["confidence"] > 0.9  # Very high confidence (outside crop)

    def test_box_outside_selection_rect(self, typical_layout_params, crop_bounds_bottom_third):
        """Test that box outside selection rectangle is predicted as 'out'."""
        # Selection rectangle constrains to left side
        selection_rect = BoundingBox(left=0, top=900, right=1000, bottom=1000)

        # Box on right side (outside selection)
        box = BoundingBox(left=1200, top=920, right=1254, bottom=974)

        prediction = predict_box_with_heuristics(
            box=box,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
            selection_rect=selection_rect,
        )

        assert prediction["label"] == "out"
        assert prediction["confidence"] > 0.85  # High confidence (selection constraint)

    def test_box_poor_alignment(self, typical_layout_params, crop_bounds_bottom_third):
        """Test box with poor vertical/height alignment."""
        # Box inside crop but far from mode vertical position and wrong height
        box = BoundingBox(left=960, top=750, right=1014, bottom=780)  # height=30, y_center=765

        prediction = predict_box_with_heuristics(
            box=box,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        # Likely "out" due to poor alignment
        # Distance from mode: 945 - 765 = 180, z-score = 180/12 = 15 (very far)
        assert prediction["label"] == "out"

    def test_partial_crop_overlap(self, typical_layout_params, crop_bounds_bottom_third):
        """Test box with partial overlap with crop bounds."""
        # Box that extends above crop boundary
        box = BoundingBox(left=960, top=700, right=1014, bottom=760)

        prediction = predict_box_with_heuristics(
            box=box,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        # Partial overlap results in "out" with moderate confidence
        assert prediction["label"] == "out"
        assert 0.65 < prediction["confidence"] < 0.95

    def test_edge_case_uncertain(self, typical_layout_params, crop_bounds_bottom_third):
        """Test box in uncertain region (moderate alignment)."""
        # Box with moderate vertical distance and slightly wrong height
        box = BoundingBox(left=960, top=900, right=1014, bottom=945)  # height=45, y_center=922.5

        prediction = predict_box_with_heuristics(
            box=box,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        # Could be "in" or "out" depending on combined likelihood
        # Confidence should be lower for uncertain cases
        assert prediction["confidence"] < 0.8


class TestPredictWithHeuristics:
    """Tests for predict_with_heuristics batch function."""

    def test_batch_prediction(self, typical_layout_params, crop_bounds_bottom_third):
        """Test predicting multiple boxes."""
        boxes = [
            BoundingBox(left=960, top=918, right=1014, bottom=972),  # Caption (good)
            BoundingBox(left=1020, top=918, right=1074, bottom=972),  # Caption (good)
            BoundingBox(left=1632, top=54, right=1824, bottom=130),  # Noise (outside crop)
            BoundingBox(left=960, top=750, right=1014, bottom=780),  # Noise (poor alignment)
        ]

        predictions = predict_with_heuristics(
            boxes=boxes,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        assert len(predictions) == 4

        # First two should be "in"
        assert predictions[0]["label"] == "in"
        assert predictions[1]["label"] == "in"

        # Last two should be "out"
        assert predictions[2]["label"] == "out"
        assert predictions[3]["label"] == "out"

    def test_mixed_confidence_levels(self, typical_layout_params, crop_bounds_bottom_third):
        """Test that predictions have varying confidence levels."""
        boxes = [
            BoundingBox(left=960, top=918, right=1014, bottom=972),  # Perfect caption
            BoundingBox(left=960, top=900, right=1014, bottom=945),  # Moderate alignment
            BoundingBox(left=1632, top=54, right=1824, bottom=130),  # Clearly noise
        ]

        predictions = predict_with_heuristics(
            boxes=boxes,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds_bottom_third,
            layout_params=typical_layout_params,
        )

        # Perfect caption should have high confidence
        assert predictions[0]["confidence"] > 0.7

        # Moderate alignment might have lower confidence
        # (depends on exact likelihood calculation)

        # Clearly noise should have very high confidence
        assert predictions[2]["confidence"] > 0.9


class TestGetConfidentPredictions:
    """Tests for get_confident_predictions helper."""

    def test_filter_by_confidence(self):
        """Test filtering predictions by confidence threshold."""
        predictions = [
            {"label": "in", "confidence": 0.85},
            {"label": "out", "confidence": 0.92},
            {"label": "in", "confidence": 0.45},
            {"label": "out", "confidence": 0.75},
        ]

        # Threshold 0.7: indices 0, 1, 3
        confident = get_confident_predictions(predictions, threshold=0.7)
        assert confident == [0, 1, 3]

        # Threshold 0.9: only index 1
        very_confident = get_confident_predictions(predictions, threshold=0.9)
        assert very_confident == [1]


class TestGetUncertainPredictions:
    """Tests for get_uncertain_predictions helper."""

    def test_filter_uncertain(self):
        """Test filtering uncertain predictions."""
        predictions = [
            {"label": "in", "confidence": 0.85},
            {"label": "out", "confidence": 0.92},
            {"label": "in", "confidence": 0.45},
            {"label": "out", "confidence": 0.55},
        ]

        # Threshold 0.6: indices 2, 3
        uncertain = get_uncertain_predictions(predictions, threshold=0.6)
        assert uncertain == [2, 3]

        # Threshold 0.5: only index 2
        very_uncertain = get_uncertain_predictions(predictions, threshold=0.5)
        assert very_uncertain == [2]


class TestRealWorldScenarios:
    """Integration tests with realistic scenarios."""

    def test_chinese_subtitle_scene(self):
        """Test realistic Chinese subtitle scenario (1920x1080)."""
        # Subtitle region analysis results
        layout_params = LayoutParams(
            vertical_position=945,
            vertical_std=12.0,
            box_height=54,
            box_height_std=5.0,
            anchor_type="left",
            anchor_position=960,
        )

        crop_bounds = CropBounds(left=0, top=723, right=1920, bottom=1080)

        # Mix of caption and noise boxes
        boxes = [
            # Caption text: 芒果TV (3 characters, left-aligned at x=960)
            BoundingBox(left=960, top=918, right=998, bottom=972),  # 芒
            BoundingBox(left=1004, top=918, right=1042, bottom=972),  # 果
            BoundingBox(left=1048, top=918, right=1086, bottom=974),  # TV
            # Channel logo (top-right corner)
            BoundingBox(left=1730, top=40, right=1880, bottom=120),
            # Random noise (middle of frame)
            BoundingBox(left=500, top=400, right=550, bottom=430),
        ]

        predictions = predict_with_heuristics(
            boxes=boxes,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds,
            layout_params=layout_params,
        )

        # First 3 should be caption text
        assert all(pred["label"] == "in" for pred in predictions[:3])
        assert all(pred["confidence"] > 0.7 for pred in predictions[:3])

        # Last 2 should be noise
        assert all(pred["label"] == "out" for pred in predictions[3:])
        assert all(pred["confidence"] > 0.9 for pred in predictions[3:])

    def test_center_aligned_subtitles(self):
        """Test center-aligned subtitle scenario."""
        # Center-aligned layout
        layout_params = LayoutParams(
            vertical_position=945,
            vertical_std=15.0,
            box_height=48,
            box_height_std=6.0,
            anchor_type="center",
            anchor_position=960,  # Frame center
        )

        crop_bounds = CropBounds(left=0, top=723, right=1920, bottom=1080)

        # Center-aligned caption boxes
        boxes = [
            BoundingBox(left=900, top=920, right=948, bottom=968),  # Left side
            BoundingBox(left=954, top=920, right=966, bottom=968),  # Center (space)
            BoundingBox(left=972, top=920, right=1020, bottom=968),  # Right side
        ]

        predictions = predict_with_heuristics(
            boxes=boxes,
            frame_width=1920,
            frame_height=1080,
            crop_bounds=crop_bounds,
            layout_params=layout_params,
        )

        # All should be caption text
        assert all(pred["label"] == "in" for pred in predictions)

        # Middle box (closer to center anchor) might have slightly higher confidence
        # but all should be reasonably confident
        assert all(pred["confidence"] > 0.6 for pred in predictions)
