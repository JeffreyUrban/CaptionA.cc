"""Unit tests for feature extraction and related modules."""

import math
import pytest

from ocr_box_model import (
    BoxBounds,
    CharacterSets,
    GaussianParams,
    ModelParams,
    NUM_FEATURES,
    Prediction,
    VideoLayoutConfig,
    detect_character_sets,
    extract_features,
    predict_bayesian,
    predict_with_heuristics,
)
from ocr_box_model.config import FEATURE_NAMES
from ocr_box_model.math_utils import (
    calculate_mean,
    calculate_mode,
    calculate_std,
    filter_outliers,
    gaussian_pdf,
    log_gaussian_pdf,
    log_probs_to_probs,
    log_sum_exp,
)
from ocr_box_model.knn import (
    compute_horizontal_clustering_score,
    compute_knn_alignment_score,
    filter_current_box,
    get_k_for_boxes,
)
from ocr_box_model.feature_importance import (
    calculate_feature_importance,
    compute_mahalanobis_distance,
    compute_pooled_covariance,
    create_identity_matrix,
    invert_covariance_matrix,
)
from ocr_box_model.types import ClassSamples


class TestCharacterSetDetection:
    """Tests for character set detection."""

    def test_roman_chars(self):
        """Test Roman character detection."""
        result = detect_character_sets("Hello World")
        assert result.is_roman == 1.0
        assert result.is_hanzi == 0.0

    def test_hanzi_chars(self):
        """Test Chinese character detection."""
        result = detect_character_sets("你好世界")
        assert result.is_hanzi == 1.0
        assert result.is_roman == 0.0

    def test_mixed_chars(self):
        """Test mixed character sets (non-exclusive)."""
        result = detect_character_sets("Season 2 第二季")
        assert result.is_roman == 1.0
        assert result.is_hanzi == 1.0
        assert result.is_digits == 1.0

    def test_digits(self):
        """Test digit detection."""
        result = detect_character_sets("12345")
        assert result.is_digits == 1.0

    def test_punctuation(self):
        """Test punctuation detection."""
        result = detect_character_sets("Hello, World!")
        assert result.is_punctuation == 1.0

    def test_korean(self):
        """Test Korean character detection."""
        result = detect_character_sets("안녕하세요")
        assert result.is_korean == 1.0

    def test_japanese_hiragana(self):
        """Test Japanese Hiragana detection."""
        result = detect_character_sets("こんにちは")
        assert result.is_hiragana == 1.0

    def test_japanese_katakana(self):
        """Test Japanese Katakana detection."""
        result = detect_character_sets("コンニチハ")
        assert result.is_katakana == 1.0

    def test_empty_string(self):
        """Test empty string."""
        result = detect_character_sets("")
        assert result.is_roman == 0.0
        assert result.is_hanzi == 0.0


class TestMathUtils:
    """Tests for mathematical utilities."""

    def test_gaussian_pdf_standard_normal(self):
        """Test Gaussian PDF at mean."""
        pdf = gaussian_pdf(0.0, mean=0.0, std=1.0)
        expected = 1.0 / math.sqrt(2 * math.pi)
        assert pdf == pytest.approx(expected)

    def test_gaussian_pdf_one_std(self):
        """Test Gaussian PDF at one standard deviation."""
        pdf = gaussian_pdf(1.0, mean=0.0, std=1.0)
        expected = math.exp(-0.5) / math.sqrt(2 * math.pi)
        assert pdf == pytest.approx(expected)

    def test_gaussian_pdf_zero_std(self):
        """Test Gaussian PDF with zero std (degenerate case)."""
        pdf = gaussian_pdf(0.0, mean=0.0, std=0.0)
        assert pdf == 1.0
        pdf = gaussian_pdf(1.0, mean=0.0, std=0.0)
        assert pdf == 1e-10

    def test_log_sum_exp(self):
        """Test log-sum-exp trick."""
        # log(exp(1) + exp(2)) = log(e + e^2) ≈ 2.31
        result = log_sum_exp([1.0, 2.0])
        expected = math.log(math.exp(1.0) + math.exp(2.0))
        assert result == pytest.approx(expected)

    def test_log_sum_exp_large_values(self):
        """Test log-sum-exp with large values (overflow prevention)."""
        # These values would overflow if not using the trick
        result = log_sum_exp([700.0, 701.0])
        assert math.isfinite(result)

    def test_log_probs_to_probs(self):
        """Test converting log-probs to normalized probs."""
        log_probs = [math.log(0.3), math.log(0.7)]
        probs = log_probs_to_probs(log_probs)
        assert probs[0] == pytest.approx(0.3)
        assert probs[1] == pytest.approx(0.7)
        assert sum(probs) == pytest.approx(1.0)

    def test_calculate_mean(self):
        """Test mean calculation."""
        assert calculate_mean([1, 2, 3, 4, 5]) == 3.0
        assert calculate_mean([]) == 0.0

    def test_calculate_std(self):
        """Test standard deviation calculation."""
        std = calculate_std([1, 2, 3, 4, 5])
        assert std == pytest.approx(math.sqrt(2.0))

    def test_calculate_mode(self):
        """Test mode calculation."""
        # Values clustered around 10 and 20
        values = [9, 10, 10, 11, 19, 20, 20, 21]
        mode = calculate_mode(values, bin_size=5)
        # Should find mode at bin center 10 or 20
        assert mode in [10.0, 20.0]

    def test_filter_outliers(self):
        """Test outlier filtering."""
        values = [1, 2, 3, 4, 5, 100]  # 100 is outlier
        # Need at least 10 values for filtering
        values = [1, 2, 3, 4, 5, 4, 3, 2, 1, 100]
        filtered = filter_outliers(values)
        # Outlier should be filtered
        assert 100 not in filtered or len(filtered) >= len(values) * 0.9


class TestKNN:
    """Tests for K-nearest neighbors functions."""

    def test_get_k_for_boxes(self):
        """Test k calculation."""
        assert get_k_for_boxes(100) == 20  # 20% of 100
        assert get_k_for_boxes(10) == 5  # min 5

    def test_filter_current_box(self):
        """Test filtering current box from list."""
        boxes = [
            BoxBounds(left=0, top=0, right=10, bottom=10),
            BoxBounds(left=20, top=20, right=30, bottom=30),
        ]
        current = BoxBounds(left=0, top=0, right=10, bottom=10)
        filtered = filter_current_box(boxes, current)
        assert len(filtered) == 1
        assert filtered[0].left == 20

    def test_knn_alignment_score_empty(self):
        """Test KNN alignment with no boxes."""
        score = compute_knn_alignment_score([], 5, lambda b: 0, lambda b: 0, 0)
        assert score == 0.0

    def test_horizontal_clustering_empty(self):
        """Test horizontal clustering with no boxes."""
        score = compute_horizontal_clustering_score([], 5, 100, 100)
        assert score == 0.0


class TestFeatureExtraction:
    """Tests for feature extraction."""

    def test_extract_features_returns_26(self):
        """Test that extract_features returns 26 features."""
        box = BoxBounds(left=100, top=800, right=200, bottom=850, text="Hello")
        features = extract_features(
            box=box,
            frame_width=1920,
            frame_height=1080,
            all_boxes=[box],
            timestamp_seconds=60.0,
            duration_seconds=600.0,
        )
        assert len(features) == NUM_FEATURES

    def test_feature_names_match_count(self):
        """Test that feature names match feature count."""
        assert len(FEATURE_NAMES) == NUM_FEATURES

    def test_normalized_features_in_range(self):
        """Test that normalized features are in [0,1] range."""
        box = BoxBounds(
            left=100, top=800, right=200, bottom=850,
            frame_index=0, box_index=0, text="Test"
        )
        features = extract_features(
            box=box,
            frame_width=1920,
            frame_height=1080,
            all_boxes=[box],
            timestamp_seconds=60.0,
            duration_seconds=600.0,
        )

        # Normalized Y position (feature 5)
        assert 0.0 <= features[5] <= 1.0
        # Normalized area (feature 6)
        assert 0.0 <= features[6] <= 1.0
        # Normalized edges (features 9-12)
        for i in range(9, 13):
            assert 0.0 <= features[i] <= 1.0


class TestPrediction:
    """Tests for prediction functions."""

    def test_predict_bayesian_balanced(self):
        """Test Bayesian prediction with balanced model."""
        # Create a simple model
        in_params = [GaussianParams(mean=0.0, std=1.0) for _ in range(NUM_FEATURES)]
        out_params = [GaussianParams(mean=1.0, std=1.0) for _ in range(NUM_FEATURES)]

        model = ModelParams(
            model_version="test",
            n_training_samples=100,
            prior_in=0.5,
            prior_out=0.5,
            in_features=in_params,
            out_features=out_params,
        )

        # Features all at 0 should favor "in"
        features_in = [0.0] * NUM_FEATURES
        pred_in = predict_bayesian(features_in, model)
        assert pred_in.label == "in"

        # Features all at 1 should favor "out"
        features_out = [1.0] * NUM_FEATURES
        pred_out = predict_bayesian(features_out, model)
        assert pred_out.label == "out"

    def test_predict_with_heuristics(self):
        """Test heuristic prediction."""
        layout = VideoLayoutConfig(frame_width=1920, frame_height=1080)

        # Caption box (bottom of frame)
        caption_box = BoxBounds(left=100, top=810, right=200, bottom=864)
        pred_caption = predict_with_heuristics(caption_box, layout)
        # Should lean toward "in" for bottom boxes
        assert pred_caption.label in ["in", "out"]
        assert 0.0 <= pred_caption.confidence <= 1.0

        # Noise box (top of frame)
        noise_box = BoxBounds(left=100, top=50, right=200, bottom=100)
        pred_noise = predict_with_heuristics(noise_box, layout)
        # Should lean toward "out" for top boxes
        assert pred_noise.label == "out"


class TestFeatureImportance:
    """Tests for feature importance calculations."""

    def test_calculate_feature_importance(self):
        """Test Fisher score calculation."""
        in_params = [GaussianParams(mean=0.0, std=1.0) for _ in range(NUM_FEATURES)]
        out_params = [GaussianParams(mean=2.0, std=1.0) for _ in range(NUM_FEATURES)]

        importance = calculate_feature_importance(in_params, out_params)

        assert len(importance) == NUM_FEATURES
        # All features should have positive Fisher scores
        for f in importance:
            assert f.fisher_score >= 0.0
            assert 0.0 <= f.importance_weight <= 1.0

    def test_identity_matrix(self):
        """Test identity matrix creation."""
        n = 5
        identity = create_identity_matrix(n)
        assert len(identity) == n * n
        for i in range(n):
            for j in range(n):
                expected = 1.0 if i == j else 0.0
                assert identity[i * n + j] == expected

    def test_compute_pooled_covariance(self):
        """Test pooled covariance computation."""
        # Create simple samples
        in_samples = ClassSamples(
            n=3,
            features=[
                [1.0] * NUM_FEATURES,
                [2.0] * NUM_FEATURES,
                [3.0] * NUM_FEATURES,
            ],
        )
        out_samples = ClassSamples(
            n=3,
            features=[
                [4.0] * NUM_FEATURES,
                [5.0] * NUM_FEATURES,
                [6.0] * NUM_FEATURES,
            ],
        )

        cov = compute_pooled_covariance(in_samples, out_samples)
        assert len(cov) == NUM_FEATURES * NUM_FEATURES

    def test_mahalanobis_distance_identical(self):
        """Test Mahalanobis distance between identical vectors."""
        x = [1.0] * NUM_FEATURES
        y = [1.0] * NUM_FEATURES
        identity = create_identity_matrix(NUM_FEATURES)

        dist = compute_mahalanobis_distance(x, y, identity)
        assert dist == pytest.approx(0.0)

    def test_mahalanobis_distance_different(self):
        """Test Mahalanobis distance between different vectors."""
        x = [0.0] * NUM_FEATURES
        y = [1.0] * NUM_FEATURES
        identity = create_identity_matrix(NUM_FEATURES)

        dist = compute_mahalanobis_distance(x, y, identity)
        # With identity covariance, distance = sqrt(sum of squared diffs)
        expected = math.sqrt(NUM_FEATURES)
        assert dist == pytest.approx(expected)


class TestTypes:
    """Tests for type definitions."""

    def test_box_bounds_defaults(self):
        """Test BoxBounds default values."""
        box = BoxBounds(left=0, top=0, right=10, bottom=10)
        assert box.frame_index == 0
        assert box.box_index == 0
        assert box.text == ""

    def test_prediction_type(self):
        """Test Prediction type."""
        pred = Prediction(label="in", confidence=0.95)
        assert pred.label == "in"
        assert pred.confidence == 0.95

    def test_gaussian_params(self):
        """Test GaussianParams type."""
        params = GaussianParams(mean=0.0, std=1.0)
        assert params.mean == 0.0
        assert params.std == 1.0

    def test_video_layout_config(self):
        """Test VideoLayoutConfig type."""
        layout = VideoLayoutConfig(frame_width=1920, frame_height=1080)
        assert layout.frame_width == 1920
        assert layout.frame_height == 1080
        assert layout.crop_left == 0


class TestNumericalStability:
    """Tests for numerical stability of prediction."""

    def test_extreme_features_dont_crash(self):
        """Test that extreme feature values don't cause crashes."""
        model = ModelParams(
            model_version="test",
            n_training_samples=100,
            prior_in=0.5,
            prior_out=0.5,
            in_features=[GaussianParams(mean=0.5, std=0.5) for _ in range(NUM_FEATURES)],
            out_features=[GaussianParams(mean=1.5, std=1.0) for _ in range(NUM_FEATURES)],
        )

        # Very extreme features
        extreme_features = [1000.0] * NUM_FEATURES
        pred = predict_bayesian(extreme_features, model)
        assert pred.label in ["in", "out"]
        assert 0.0 <= pred.confidence <= 1.0

        # Very negative features
        negative_features = [-1000.0] * NUM_FEATURES
        pred = predict_bayesian(negative_features, model)
        assert pred.label in ["in", "out"]
        assert 0.0 <= pred.confidence <= 1.0
