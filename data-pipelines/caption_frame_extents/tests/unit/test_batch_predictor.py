"""Unit tests for batch predictor."""

import sqlite3
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch
from PIL import Image

from caption_frame_extents.inference.batch_predictor import (
    BatchCaptionFrameExtentsPredictor,
)


def create_test_image(
    width: int = 480, height: int = 48, color: tuple = (100, 150, 200)
) -> Image.Image:
    """Create a test PIL image."""
    img = Image.new("RGB", (width, height), color)
    return img


def create_mock_layout_db(tmp_path: Path) -> Path:
    """Create a mock layout.db with required schema and test data."""
    db_path = tmp_path / "layout.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create layout config table
    cursor.execute("""
        CREATE TABLE video_layout_config (
            anchor_type TEXT,
            crop_left INTEGER,
            crop_top INTEGER,
            crop_right INTEGER,
            crop_bottom INTEGER,
            frame_width INTEGER,
            frame_height INTEGER,
            ocr_visualization_image BLOB
        )
    """)

    # Create test OCR visualization image
    ocr_viz_img = create_test_image(480, 48, (255, 255, 255))
    img_bytes = BytesIO()
    ocr_viz_img.save(img_bytes, format="PNG")
    ocr_viz_blob = img_bytes.getvalue()

    # Insert test data
    cursor.execute(
        """
        INSERT INTO video_layout_config VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("center", 100, 450, 580, 498, 1920, 1080, ocr_viz_blob),
    )

    conn.commit()
    conn.close()

    return db_path


def create_mock_checkpoint(tmp_path: Path) -> Path:
    """Create a mock model checkpoint."""
    checkpoint_path = tmp_path / "test_model.pt"

    # Create minimal checkpoint with required fields
    checkpoint = {
        "model_state_dict": {},  # Empty - will be mocked
        "config": {
            "architecture_name": "test_architecture",
            "model_config": {"pretrained": False},
            "transform_strategy": "mirror_tile",
            "ocr_visualization_variant": "boundaries",
        },
    }

    torch.save(checkpoint, checkpoint_path)
    return checkpoint_path


class TestBatchCaptionFrameExtentsPredictorInit:
    """Tests for BatchCaptionFrameExtentsPredictor initialization."""

    def test_init_fails_without_layout_config(self, tmp_path):
        """Should fail if layout.db has no config."""
        # Create empty database
        db_path = tmp_path / "layout.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE video_layout_config (
                anchor_type TEXT,
                crop_left INTEGER,
                crop_top INTEGER,
                crop_right INTEGER,
                crop_bottom INTEGER,
                frame_width INTEGER,
                frame_height INTEGER,
                ocr_visualization_image BLOB
            )
        """)
        conn.commit()
        conn.close()

        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            with pytest.raises(ValueError, match="No layout config found"):
                BatchCaptionFrameExtentsPredictor(
                    checkpoint_path=checkpoint_path,
                    layout_db_path=db_path,
                    device="cpu",
                )

    def test_init_fails_without_ocr_viz(self, tmp_path):
        """Should fail if OCR visualization is missing."""
        db_path = tmp_path / "layout.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE video_layout_config (
                anchor_type TEXT,
                crop_left INTEGER,
                crop_top INTEGER,
                crop_right INTEGER,
                crop_bottom INTEGER,
                frame_width INTEGER,
                frame_height INTEGER,
                ocr_visualization_image BLOB
            )
        """)
        # Insert config without OCR viz blob
        cursor.execute(
            "INSERT INTO video_layout_config VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("center", 100, 450, 580, 498, 1920, 1080, None),
        )
        conn.commit()
        conn.close()

        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            with pytest.raises(ValueError, match="OCR visualization not found"):
                BatchCaptionFrameExtentsPredictor(
                    checkpoint_path=checkpoint_path,
                    layout_db_path=db_path,
                    device="cpu",
                )

    def test_init_loads_model_from_registry(self, tmp_path):
        """Should load model using create_model from registry."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_model.eval = MagicMock()
            mock_model.load_state_dict = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            assert predictor is not None
            mock_create.assert_called_once()
            mock_model.eval.assert_called_once()

    def test_init_auto_detects_cpu_device(self, tmp_path):
        """Should auto-detect CPU when no GPU available."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            with patch("torch.cuda.is_available", return_value=False):
                with patch("torch.backends.mps.is_available", return_value=False):
                    predictor = BatchCaptionFrameExtentsPredictor(
                        checkpoint_path=checkpoint_path,
                        layout_db_path=layout_db_path,
                        device=None,
                    )
                    assert predictor.device == "cpu"


class TestBatchCaptionFrameExtentsPredictorSpatialFeatures:
    """Tests for spatial feature computation."""

    def test_left_anchor_encoding(self, tmp_path):
        """Left anchor should have encoding [1, 0, 0]."""
        db_path = tmp_path / "layout.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE video_layout_config (
                anchor_type TEXT,
                crop_left INTEGER,
                crop_top INTEGER,
                crop_right INTEGER,
                crop_bottom INTEGER,
                frame_width INTEGER,
                frame_height INTEGER,
                ocr_visualization_image BLOB
            )
        """)

        ocr_viz_img = create_test_image(480, 48)
        img_bytes = BytesIO()
        ocr_viz_img.save(img_bytes, format="PNG")

        cursor.execute(
            "INSERT INTO video_layout_config VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("left", 0, 450, 480, 498, 1920, 1080, img_bytes.getvalue()),
        )
        conn.commit()
        conn.close()

        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=db_path,
                device="cpu",
            )

            # Check anchor encoding is first 3 elements
            assert predictor.spatial_features[:3] == [1.0, 0.0, 0.0]

    def test_center_anchor_encoding(self, tmp_path):
        """Center anchor should have encoding [0, 1, 0]."""
        layout_db_path = create_mock_layout_db(tmp_path)  # Uses center anchor
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            assert predictor.spatial_features[:3] == [0.0, 1.0, 0.0]

    def test_right_anchor_encoding(self, tmp_path):
        """Right anchor should have encoding [0, 0, 1]."""
        db_path = tmp_path / "layout.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE video_layout_config (
                anchor_type TEXT,
                crop_left INTEGER,
                crop_top INTEGER,
                crop_right INTEGER,
                crop_bottom INTEGER,
                frame_width INTEGER,
                frame_height INTEGER,
                ocr_visualization_image BLOB
            )
        """)

        ocr_viz_img = create_test_image(480, 48)
        img_bytes = BytesIO()
        ocr_viz_img.save(img_bytes, format="PNG")

        cursor.execute(
            "INSERT INTO video_layout_config VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("right", 1440, 450, 1920, 498, 1920, 1080, img_bytes.getvalue()),
        )
        conn.commit()
        conn.close()

        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=db_path,
                device="cpu",
            )

            assert predictor.spatial_features[:3] == [0.0, 0.0, 1.0]

    def test_spatial_features_has_six_elements(self, tmp_path):
        """Spatial features should have 6 elements: [anchor(3), x, y, w]."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            assert len(predictor.spatial_features) == 6

    def test_normalized_position_values(self, tmp_path):
        """Normalized position values should be between 0 and 1."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            # x_norm, y_norm, w_norm are elements 3, 4, 5
            x_norm = predictor.spatial_features[3]
            y_norm = predictor.spatial_features[4]
            w_norm = predictor.spatial_features[5]

            assert 0.0 <= x_norm <= 1.0
            assert 0.0 <= y_norm <= 1.0
            assert 0.0 <= w_norm <= 1.0


class TestBatchCaptionFrameExtentsPredictorPrediction:
    """Tests for prediction methods."""

    @pytest.fixture
    def predictor(self, tmp_path):
        """Create a predictor with mocked model for testing."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_model.eval = MagicMock(return_value=None)
            mock_model.load_state_dict = MagicMock(return_value=None)

            # Mock model forward pass to return reasonable logits
            def mock_forward(ocr_viz, _frame1, _frame2, _spatial):
                batch_size = ocr_viz.shape[0]
                # Return logits that favor "same" class (index 0)
                logits = torch.zeros(batch_size, 5)
                logits[:, 0] = 2.0  # Higher logit for "same"
                return logits

            mock_model.side_effect = mock_forward

            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            return predictor

    def test_predict_frame_pair_returns_dict(self, predictor):
        """predict_frame_pair should return dict with expected keys."""
        frame1 = create_test_image()
        frame2 = create_test_image()

        result = predictor.predict_frame_pair(frame1, frame2)

        assert isinstance(result, dict)
        assert "predicted_label" in result
        assert "probabilities" in result
        assert "confidence" in result

    def test_predict_frame_pair_label_is_valid(self, predictor):
        """Predicted label should be one of the valid labels."""
        frame1 = create_test_image()
        frame2 = create_test_image()

        result = predictor.predict_frame_pair(frame1, frame2)

        valid_labels = [
            "same",
            "different",
            "empty_empty",
            "empty_valid",
            "valid_empty",
        ]
        assert result["predicted_label"] in valid_labels

    def test_predict_frame_pair_probabilities_sum_to_one(self, predictor):
        """Probabilities should sum to approximately 1."""
        frame1 = create_test_image()
        frame2 = create_test_image()

        result = predictor.predict_frame_pair(frame1, frame2)

        prob_sum = sum(result["probabilities"].values())
        assert abs(prob_sum - 1.0) < 1e-5

    def test_predict_frame_pair_confidence_matches_max_prob(self, predictor):
        """Confidence should equal the max probability."""
        frame1 = create_test_image()
        frame2 = create_test_image()

        result = predictor.predict_frame_pair(frame1, frame2)

        max_prob = max(result["probabilities"].values())
        assert abs(result["confidence"] - max_prob) < 1e-5

    def test_predict_batch_returns_list(self, predictor):
        """predict_batch should return list of results."""
        frames = [
            (create_test_image(), create_test_image()),
            (create_test_image(), create_test_image()),
        ]

        results = predictor.predict_batch(frames)

        assert isinstance(results, list)
        assert len(results) == 2

    def test_predict_batch_preserves_order(self, predictor):
        """Results should be in same order as input pairs."""
        frames = [
            (
                create_test_image(color=(255, 0, 0)),
                create_test_image(color=(0, 255, 0)),
            ),
            (
                create_test_image(color=(0, 0, 255)),
                create_test_image(color=(255, 255, 0)),
            ),
            (
                create_test_image(color=(255, 0, 255)),
                create_test_image(color=(0, 255, 255)),
            ),
        ]

        results = predictor.predict_batch(frames)

        assert len(results) == 3

    def test_predict_batch_empty_input(self, predictor):
        """Empty input should return empty list."""
        results = predictor.predict_batch([])
        assert results == []

    def test_predict_batch_handles_large_batch(self, predictor):
        """Should handle batches larger than batch_size."""
        frames = [(create_test_image(), create_test_image()) for _ in range(100)]

        results = predictor.predict_batch(frames, batch_size=32)

        assert len(results) == 100

    def test_predict_batch_each_result_has_expected_structure(self, predictor):
        """Each result in batch should have expected structure."""
        frames = [
            (create_test_image(), create_test_image()),
            (create_test_image(), create_test_image()),
        ]

        results = predictor.predict_batch(frames)

        for result in results:
            assert "predicted_label" in result
            assert "probabilities" in result
            assert "confidence" in result
            assert len(result["probabilities"]) == 5


class TestBatchCaptionFrameExtentsPredictorLabels:
    """Tests for label mapping."""

    def test_labels_match_dataset_labels(self, tmp_path):
        """Labels should match CaptionFrameExtentsDataset.LABELS."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            expected_labels = [
                "same",
                "different",
                "empty_empty",
                "empty_valid",
                "valid_empty",
            ]
            assert predictor.labels == expected_labels

    def test_label_to_idx_mapping(self, tmp_path):
        """label_to_idx should correctly map labels to indices."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch(
            "caption_frame_extents.inference.batch_predictor.create_model"
        ) as mock_create:
            mock_model = MagicMock()
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            assert predictor.label_to_idx["same"] == 0
            assert predictor.label_to_idx["different"] == 1
            assert predictor.label_to_idx["empty_empty"] == 2
            assert predictor.label_to_idx["empty_valid"] == 3
            assert predictor.label_to_idx["valid_empty"] == 4
