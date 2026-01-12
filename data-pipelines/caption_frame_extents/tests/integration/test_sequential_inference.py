"""Integration tests for sequential frame inference.

Tests the end-to-end flow of processing sequential frame pairs
for caption frame extents detection, including bidirectional inference.
"""

import sqlite3
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch
from PIL import Image

from caption_frame_extents.inference.batch_predictor import BatchCaptionFrameExtentsPredictor
from caption_frame_extents.inference.caption_frame_extents_db import PairResult, create_caption_frame_extents_db
from caption_frame_extents.inference.quality_checks import run_quality_checks


def create_test_frame(width: int = 480, height: int = 48, seed: int = 0) -> Image.Image:
    """Create a test frame with reproducible pattern."""
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    assert pixels is not None

    for x in range(width):
        for y in range(height):
            r = (x + seed * 50) % 256
            g = (y + seed * 30) % 256
            b = ((x + y) + seed * 20) % 256
            pixels[x, y] = (r, g, b)

    return img


def create_mock_layout_db(tmp_path: Path) -> Path:
    """Create a mock layout.db with required schema and test data."""
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

    ocr_viz_img = create_test_frame(480, 48, seed=99)
    img_bytes = BytesIO()
    ocr_viz_img.save(img_bytes, format="PNG")

    cursor.execute(
        "INSERT INTO video_layout_config VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("center", 720, 1000, 1200, 1048, 1920, 1080, img_bytes.getvalue()),
    )

    conn.commit()
    conn.close()

    return db_path


def create_mock_checkpoint(tmp_path: Path) -> Path:
    """Create a mock model checkpoint."""
    checkpoint_path = tmp_path / "test_model.pt"

    checkpoint = {
        "model_state_dict": {},
        "config": {
            "architecture_name": "test_architecture",
            "model_config": {"pretrained": False},
            "transform_strategy": "mirror_tile",
            "ocr_visualization_variant": "boundaries",
        },
    }

    torch.save(checkpoint, checkpoint_path)
    return checkpoint_path


class TestSequentialFrameInference:
    """Tests for sequential frame inference patterns."""

    @pytest.fixture
    def mock_predictor(self, tmp_path):
        """Create a predictor with deterministic mock predictions."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch("caption_frame_extents.inference.batch_predictor.create_model") as mock_create:
            mock_model = MagicMock()
            mock_model.eval = MagicMock(return_value=None)
            mock_model.load_state_dict = MagicMock(return_value=None)

            # Deterministic predictions based on batch position
            def mock_forward(ocr_viz, _frame1, _frame2, _spatial):
                batch_size = ocr_viz.shape[0]
                logits = torch.zeros(batch_size, 5)
                for i in range(batch_size):
                    if i % 5 == 0:
                        logits[i, 1] = 2.0  # "different"
                    else:
                        logits[i, 0] = 2.0  # "same"
                return logits

            mock_model.side_effect = mock_forward
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            return predictor

    @pytest.mark.integration
    def test_sequential_pairs_processed_in_order(self, mock_predictor):
        """Sequential frame pairs should be processed in order."""
        frames = [create_test_frame(seed=i) for i in range(10)]

        # Create sequential pairs: (0,1), (1,2), (2,3), ...
        frame_pairs = [(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]

        results = mock_predictor.predict_batch(frame_pairs)

        assert len(results) == 9
        for result in results:
            assert result["predicted_label"] in ["same", "different", "empty_empty", "empty_valid", "valid_empty"]

    @pytest.mark.integration
    def test_bidirectional_inference_pattern(self, mock_predictor):
        """Bidirectional inference should process both directions."""
        frames = [create_test_frame(seed=i) for i in range(5)]

        # Simulate bidirectional pattern from service.py
        frame_pairs = [(0, 1), (1, 2), (2, 3), (3, 4)]

        bidirectional_pairs = []
        for i in range(len(frame_pairs)):
            f1_idx, f2_idx = frame_pairs[i]
            f1, f2 = frames[f1_idx], frames[f2_idx]
            bidirectional_pairs.append((f1, f2))  # Forward
            bidirectional_pairs.append((f2, f1))  # Backward

        all_predictions = mock_predictor.predict_batch(bidirectional_pairs)

        # Should have 2x predictions (forward + backward)
        assert len(all_predictions) == len(frame_pairs) * 2

        # Split back into forward/backward
        forward_predictions = [all_predictions[i * 2] for i in range(len(frame_pairs))]
        backward_predictions = [all_predictions[i * 2 + 1] for i in range(len(frame_pairs))]

        assert len(forward_predictions) == 4
        assert len(backward_predictions) == 4

    @pytest.mark.integration
    def test_large_sequential_batch(self, mock_predictor):
        """Should handle large sequential batches efficiently."""
        frames = [create_test_frame(seed=i) for i in range(100)]
        frame_pairs = [(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]

        results = mock_predictor.predict_batch(frame_pairs, batch_size=32)

        assert len(results) == 99

    @pytest.mark.integration
    def test_predictions_include_all_probability_classes(self, mock_predictor):
        """All predictions should include probabilities for all 5 classes."""
        frames = [create_test_frame(seed=i) for i in range(3)]
        frame_pairs = [(frames[0], frames[1]), (frames[1], frames[2])]

        results = mock_predictor.predict_batch(frame_pairs)

        expected_classes = ["same", "different", "empty_empty", "empty_valid", "valid_empty"]
        for result in results:
            for cls in expected_classes:
                assert cls in result["probabilities"]


class TestCaptionFrameExtentsDatabaseCreation:
    """Tests for caption frame extents database creation from inference results."""

    @pytest.mark.integration
    def test_create_caption_frame_extents_db_from_pair_results(self, tmp_path):
        """Should create valid caption frame extents database from PairResults."""
        from datetime import datetime

        db_path = tmp_path / "caption_frame_extents.db"

        results = [
            PairResult(
                frame1_index=0,
                frame2_index=1,
                forward_predicted_label="same",
                forward_confidence=0.95,
                forward_prob_same=0.95,
                forward_prob_different=0.02,
                forward_prob_empty_empty=0.01,
                forward_prob_empty_valid=0.01,
                forward_prob_valid_empty=0.01,
                backward_predicted_label="same",
                backward_confidence=0.93,
                backward_prob_same=0.93,
                backward_prob_different=0.03,
                backward_prob_empty_empty=0.01,
                backward_prob_empty_valid=0.02,
                backward_prob_valid_empty=0.01,
                processing_time_ms=50,
            ),
            PairResult(
                frame1_index=1,
                frame2_index=2,
                forward_predicted_label="different",
                forward_confidence=0.87,
                forward_prob_same=0.05,
                forward_prob_different=0.87,
                forward_prob_empty_empty=0.02,
                forward_prob_empty_valid=0.03,
                forward_prob_valid_empty=0.03,
                backward_predicted_label="different",
                backward_confidence=0.85,
                backward_prob_same=0.06,
                backward_prob_different=0.85,
                backward_prob_empty_empty=0.03,
                backward_prob_empty_valid=0.03,
                backward_prob_valid_empty=0.03,
                processing_time_ms=48,
            ),
        ]

        create_caption_frame_extents_db(
            db_path=db_path,
            cropped_frames_version=1,
            model_version="abc123def456",
            run_id="test-run-123",
            started_at=datetime.now(),
            completed_at=datetime.now(),
            results=results,
            model_checkpoint_path="/models/test.pt",
        )

        assert db_path.exists()

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Verify metadata
        cursor.execute("SELECT run_id, total_pairs FROM run_metadata")
        row = cursor.fetchone()
        assert row[0] == "test-run-123"
        assert row[1] == 2

        # Verify pair results
        cursor.execute("SELECT COUNT(*) FROM pair_results")
        count = cursor.fetchone()[0]
        assert count == 2

        cursor.execute(
            "SELECT forward_predicted_label, backward_predicted_label FROM pair_results ORDER BY frame1_index"
        )
        rows = cursor.fetchall()
        assert rows[0] == ("same", "same")
        assert rows[1] == ("different", "different")

        conn.close()

    @pytest.mark.integration
    def test_caption_frame_extents_db_enforces_unique_pairs(self, tmp_path):
        """Database should enforce unique (frame1_index, frame2_index) pairs."""
        from datetime import datetime

        db_path = tmp_path / "caption_frame_extents.db"

        result = PairResult(
            frame1_index=0,
            frame2_index=1,
            forward_predicted_label="same",
            forward_confidence=0.95,
            forward_prob_same=0.95,
            forward_prob_different=0.02,
            forward_prob_empty_empty=0.01,
            forward_prob_empty_valid=0.01,
            forward_prob_valid_empty=0.01,
            backward_predicted_label="same",
            backward_confidence=0.93,
            backward_prob_same=0.93,
            backward_prob_different=0.03,
            backward_prob_empty_empty=0.01,
            backward_prob_empty_valid=0.02,
            backward_prob_valid_empty=0.01,
            processing_time_ms=50,
        )

        create_caption_frame_extents_db(
            db_path=db_path,
            cropped_frames_version=1,
            model_version="abc123",
            run_id="test-run",
            started_at=datetime.now(),
            completed_at=datetime.now(),
            results=[result],
            model_checkpoint_path="/models/test.pt",
        )

        # Try to insert duplicate - should fail
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        with pytest.raises(sqlite3.IntegrityError):
            cursor.execute(
                """
                INSERT INTO pair_results (frame1_index, frame2_index, forward_predicted_label,
                    forward_confidence, forward_prob_same, forward_prob_different,
                    forward_prob_empty_empty, forward_prob_empty_valid, forward_prob_valid_empty,
                    backward_predicted_label, backward_confidence, backward_prob_same,
                    backward_prob_different, backward_prob_empty_empty, backward_prob_empty_valid,
                    backward_prob_valid_empty)
                VALUES (0, 1, 'same', 0.9, 0.9, 0.1, 0.0, 0.0, 0.0, 'same', 0.9, 0.9, 0.1, 0.0, 0.0, 0.0)
                """
            )

        conn.close()


class TestQualityChecksIntegration:
    """Integration tests for quality checks on inference results."""

    @pytest.mark.integration
    def test_quality_checks_on_valid_sequence(self, tmp_path):
        """Quality checks should pass for valid caption frame extents sequence."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "same"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "same"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "different"},
            {"frame1_index": 3, "frame2_index": 4, "predicted_label": "same"},
            {"frame1_index": 10, "frame2_index": 11, "predicted_label": "different"},
        ]

        result = run_quality_checks(
            video_db_path=tmp_path / "fake.db",
            caption_frame_extents=caption_frame_extents,
        )

        assert result["pass_rate"] == 1.0
        assert result["coherence_check"]["coherent"] is True

    @pytest.mark.integration
    def test_quality_checks_detect_consecutive_caption_frame_extents(self, tmp_path):
        """Quality checks should flag consecutive caption frame extents predictions."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "different"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "different"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "same"},
        ]

        result = run_quality_checks(
            video_db_path=tmp_path / "fake.db",
            caption_frame_extents=caption_frame_extents,
        )

        assert result["pass_rate"] < 1.0
        assert not result["coherence_check"]["coherent"]
        assert len(result["flagged_caption_frame_extents"]) > 0

    @pytest.mark.integration
    def test_quality_checks_with_empty_labels(self, tmp_path):
        """Quality checks should handle empty-related labels correctly."""
        caption_frame_extents = [
            {"frame1_index": 0, "frame2_index": 1, "predicted_label": "empty_empty"},
            {"frame1_index": 1, "frame2_index": 2, "predicted_label": "empty_valid"},
            {"frame1_index": 2, "frame2_index": 3, "predicted_label": "valid_empty"},
            {"frame1_index": 3, "frame2_index": 4, "predicted_label": "same"},
        ]

        result = run_quality_checks(
            video_db_path=tmp_path / "fake.db",
            caption_frame_extents=caption_frame_extents,
        )

        assert result["pass_rate"] == 1.0


class TestEndToEndSequentialInference:
    """End-to-end tests for the sequential inference pipeline."""

    @pytest.fixture
    def mock_predictor_with_caption_frame_extents_detection(self, tmp_path):
        """Create predictor that detects caption frame extents at specific positions."""
        layout_db_path = create_mock_layout_db(tmp_path)
        checkpoint_path = create_mock_checkpoint(tmp_path)

        with patch("caption_frame_extents.inference.batch_predictor.create_model") as mock_create:
            mock_model = MagicMock()
            mock_model.eval = MagicMock(return_value=None)
            mock_model.load_state_dict = MagicMock(return_value=None)

            # Track call count to simulate boundaries at known positions
            call_count = [0]

            def mock_forward(ocr_viz, _frame1, _frame2, _spatial):
                batch_size = ocr_viz.shape[0]
                logits = torch.zeros(batch_size, 5)

                for i in range(batch_size):
                    idx = call_count[0] + i
                    # Simulate caption frame extents at positions 5 and 15
                    if idx in [5, 15, 10 + 5, 10 + 15]:  # Forward and backward positions
                        logits[i, 1] = 2.0  # "different"
                    else:
                        logits[i, 0] = 2.0  # "same"

                call_count[0] += batch_size
                return logits

            mock_model.side_effect = mock_forward
            mock_create.return_value = mock_model

            predictor = BatchCaptionFrameExtentsPredictor(
                checkpoint_path=checkpoint_path,
                layout_db_path=layout_db_path,
                device="cpu",
            )

            return predictor

    @pytest.mark.integration
    def test_full_pipeline_with_quality_checks(self, mock_predictor_with_caption_frame_extents_detection, tmp_path):
        """Test full pipeline: inference -> database -> quality checks."""
        from datetime import datetime

        # Create frames
        frames = [create_test_frame(seed=i) for i in range(20)]
        frame_pairs_indices = [(i, i + 1) for i in range(len(frames) - 1)]

        # Bidirectional inference
        bidirectional_pairs = []
        for f1_idx, f2_idx in frame_pairs_indices:
            bidirectional_pairs.append((frames[f1_idx], frames[f2_idx]))
            bidirectional_pairs.append((frames[f2_idx], frames[f1_idx]))

        all_predictions = mock_predictor_with_caption_frame_extents_detection.predict_batch(bidirectional_pairs)

        forward_predictions = [all_predictions[i * 2] for i in range(len(frame_pairs_indices))]
        backward_predictions = [all_predictions[i * 2 + 1] for i in range(len(frame_pairs_indices))]

        # Create PairResults
        pair_results = []
        for i, (f1_idx, f2_idx) in enumerate(frame_pairs_indices):
            fp = forward_predictions[i]
            bp = backward_predictions[i]

            pair_results.append(
                PairResult(
                    frame1_index=f1_idx,
                    frame2_index=f2_idx,
                    forward_predicted_label=fp["predicted_label"],
                    forward_confidence=fp["confidence"],
                    forward_prob_same=fp["probabilities"]["same"],
                    forward_prob_different=fp["probabilities"]["different"],
                    forward_prob_empty_empty=fp["probabilities"]["empty_empty"],
                    forward_prob_empty_valid=fp["probabilities"]["empty_valid"],
                    forward_prob_valid_empty=fp["probabilities"]["valid_empty"],
                    backward_predicted_label=bp["predicted_label"],
                    backward_confidence=bp["confidence"],
                    backward_prob_same=bp["probabilities"]["same"],
                    backward_prob_different=bp["probabilities"]["different"],
                    backward_prob_empty_empty=bp["probabilities"]["empty_empty"],
                    backward_prob_empty_valid=bp["probabilities"]["empty_valid"],
                    backward_prob_valid_empty=bp["probabilities"]["valid_empty"],
                    processing_time_ms=50,
                )
            )

        # Create database
        db_path = tmp_path / "caption_frame_extents.db"
        create_caption_frame_extents_db(
            db_path=db_path,
            cropped_frames_version=1,
            model_version="test-model-v1",
            run_id="integration-test-run",
            started_at=datetime.now(),
            completed_at=datetime.now(),
            results=pair_results,
            model_checkpoint_path="/models/test.pt",
        )

        assert db_path.exists()

        # Run quality checks
        caption_frame_extents = [
            {
                "frame1_index": pr.frame1_index,
                "frame2_index": pr.frame2_index,
                "predicted_label": pr.forward_predicted_label,
            }
            for pr in pair_results
        ]

        quality_result = run_quality_checks(
            video_db_path=tmp_path / "fake.db",
            caption_frame_extents=caption_frame_extents,
        )

        assert quality_result["quality_stats"]["total_caption_frame_extents"] == 19
        # Quality checks should complete without error
        assert "pass_rate" in quality_result
