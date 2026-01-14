"""Integration tests for GPU-accelerated full_frames processing.

These tests validate end-to-end GPU frame extraction and OCR processing.
They are skipped by default and require:
- CUDA-capable GPU
- Wasabi credentials for test video download
- Run with: pytest -m gpu --run-gpu-tests
"""

import sqlite3
from pathlib import Path

import pytest


@pytest.mark.gpu
@pytest.mark.integration
class TestGPUFrameExtraction:
    """Integration tests for GPU frame extraction."""

    def test_extract_frames_gpu_basic(self, test_video_path, tmp_path):
        """Test basic GPU frame extraction creates correct files."""
        from full_frames.frames_gpu import extract_frames_gpu

        output_dir = tmp_path / "frames"
        output_dir.mkdir()

        # Extract at 0.1 Hz (1 frame per 10 seconds)
        frame_paths = extract_frames_gpu(
            video_path=test_video_path,
            output_dir=output_dir,
            rate_hz=0.1,
        )

        # Should extract at least one frame
        assert len(frame_paths) > 0, "Should extract at least one frame"

        # Verify files exist
        for frame_path in frame_paths:
            assert frame_path.exists(), f"Frame file should exist: {frame_path}"
            assert frame_path.suffix == ".jpg", f"Frame should be JPEG: {frame_path}"
            assert frame_path.stat().st_size > 0, f"Frame should not be empty: {frame_path}"

        print(f"\n=== GPU Frame Extraction ===")
        print(f"Extracted {len(frame_paths)} frames")
        print(f"Output directory: {output_dir}")

    def test_extract_frames_gpu_naming_convention(self, test_video_path, tmp_path):
        """Test frame naming follows convention: frame_NNNNNNNNNN.jpg where N = time*10."""
        from full_frames.frames_gpu import extract_frames_gpu

        output_dir = tmp_path / "frames"
        output_dir.mkdir()

        # Extract at 0.1 Hz
        frame_paths = extract_frames_gpu(
            video_path=test_video_path,
            output_dir=output_dir,
            rate_hz=0.1,
        )

        # Verify naming convention
        for i, frame_path in enumerate(frame_paths):
            # Frame index = time_in_seconds * 10
            # At 0.1 Hz: frame 0 at 0s, frame 1 at 10s, frame 2 at 20s
            expected_time = i / 0.1
            expected_index = int(expected_time * 10)
            expected_name = f"frame_{expected_index:010d}.jpg"

            assert frame_path.name == expected_name, \
                f"Frame {i} should be named {expected_name}, got {frame_path.name}"

        print(f"\n=== Frame Naming Convention ===")
        print(f"First frame: {frame_paths[0].name}")
        if len(frame_paths) > 1:
            print(f"Last frame: {frame_paths[-1].name}")

    @pytest.mark.parametrize("rate_hz", [0.05, 0.1, 0.2])
    def test_extract_frames_gpu_different_rates(self, test_video_path, tmp_path, rate_hz):
        """Test extraction at different frame rates."""
        from full_frames.frames_gpu import extract_frames_gpu
        from gpu_video_utils import GPUVideoDecoder

        output_dir = tmp_path / f"frames_{rate_hz}"
        output_dir.mkdir()

        # Get video duration
        with GPUVideoDecoder(test_video_path) as decoder:
            video_info = decoder.get_video_info()
            duration = video_info["duration"]

        # Extract frames
        frame_paths = extract_frames_gpu(
            video_path=test_video_path,
            output_dir=output_dir,
            rate_hz=rate_hz,
        )

        # Calculate expected frame count
        expected_frames = int(duration * rate_hz)

        # Allow small tolerance for rounding
        assert abs(len(frame_paths) - expected_frames) <= 1, \
            f"At {rate_hz} Hz, expected ~{expected_frames} frames, got {len(frame_paths)}"

        print(f"\n=== Rate {rate_hz} Hz ===")
        print(f"Duration: {duration:.1f}s")
        print(f"Expected frames: {expected_frames}")
        print(f"Actual frames: {len(frame_paths)}")

    def test_extract_frames_gpu_with_cropping(self, test_video_path, tmp_path):
        """Test GPU frame extraction with cropping."""
        from full_frames.frames_gpu import extract_frames_gpu
        from gpu_video_utils import GPUVideoDecoder
        from PIL import Image

        # Get video dimensions
        with GPUVideoDecoder(test_video_path) as decoder:
            video_info = decoder.get_video_info()
            width = video_info["width"]
            height = video_info["height"]

        # Define crop region (center 50%)
        crop_left = int(width * 0.25)
        crop_top = int(height * 0.25)
        crop_right = int(width * 0.75)
        crop_bottom = int(height * 0.75)
        crop_box = (crop_left, crop_top, crop_right, crop_bottom)

        output_dir = tmp_path / "frames_cropped"
        output_dir.mkdir()

        # Extract with cropping
        frame_paths = extract_frames_gpu(
            video_path=test_video_path,
            output_dir=output_dir,
            rate_hz=0.1,
            crop_box=crop_box,
        )

        assert len(frame_paths) > 0, "Should extract frames"

        # Verify crop dimensions
        first_frame = Image.open(frame_paths[0])
        expected_width = crop_right - crop_left
        expected_height = crop_bottom - crop_top

        assert first_frame.size == (expected_width, expected_height), \
            f"Cropped frame should be {expected_width}x{expected_height}, got {first_frame.size}"

        print(f"\n=== Cropped Frame Extraction ===")
        print(f"Original: {width}x{height}")
        print(f"Cropped: {expected_width}x{expected_height}")
        print(f"Extracted {len(frame_paths)} cropped frames")

    def test_extract_frames_gpu_progress_callback(self, test_video_path, tmp_path):
        """Test progress callback functionality."""
        from full_frames.frames_gpu import extract_frames_gpu

        output_dir = tmp_path / "frames"
        output_dir.mkdir()

        progress_calls = []

        def progress_callback(current, total):
            progress_calls.append((current, total))

        frame_paths = extract_frames_gpu(
            video_path=test_video_path,
            output_dir=output_dir,
            rate_hz=0.1,
            progress_callback=progress_callback,
        )

        # Verify progress tracking
        assert len(progress_calls) > 0, "Progress callback should be called"
        assert progress_calls[-1][0] == progress_calls[-1][1], \
            "Last progress call should indicate completion"
        assert progress_calls[-1][1] == len(frame_paths), \
            "Total in progress should match frame count"

        print(f"\n=== Progress Tracking ===")
        print(f"Progress calls: {len(progress_calls)}")
        print(f"Final: {progress_calls[-1][0]}/{progress_calls[-1][1]}")


@pytest.mark.gpu
@pytest.mark.integration
class TestGPUOCRIntegration:
    """Integration tests for GPU + OCR service processing."""

    @pytest.mark.skipif(
        not Path(__file__).parent.parent.parent.parent.joinpath("services/api/app/services/wasabi_service.py").exists(),
        reason="OCR service dependencies not available"
    )
    def test_process_video_with_ocr_service(self, test_video_path, tmp_path):
        """Test end-to-end GPU extraction + OCR service processing."""
        from full_frames.ocr_service import process_video_with_gpu_and_ocr_service

        db_path = tmp_path / "ocr_results.db"

        # Process video with OCR
        total_boxes = process_video_with_gpu_and_ocr_service(
            video_path=test_video_path,
            db_path=db_path,
            rate_hz=0.1,
            language="en",
        )

        # Verify database was created
        assert db_path.exists(), "OCR database should be created"
        assert db_path.stat().st_size > 0, "Database should not be empty"

        # Verify database structure
        conn = sqlite3.connect(str(db_path))
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='full_frame_ocr'"
        )
        assert cursor.fetchone() is not None, "full_frame_ocr table should exist"

        # Count OCR boxes in database
        cursor = conn.execute("SELECT COUNT(*) FROM full_frame_ocr")
        db_count = cursor.fetchone()[0]

        assert db_count == total_boxes, \
            f"Database count {db_count} should match returned count {total_boxes}"

        conn.close()

        print(f"\n=== GPU + OCR Processing ===")
        print(f"Total OCR boxes: {total_boxes}")
        print(f"Database: {db_path}")
        print(f"Database size: {db_path.stat().st_size / 1024:.1f} KB")

    @pytest.mark.skipif(
        not Path(__file__).parent.parent.parent.parent.joinpath("services/api/app/services/wasabi_service.py").exists(),
        reason="OCR service dependencies not available"
    )
    def test_ocr_with_different_languages(self, test_video_path, tmp_path):
        """Test OCR with different language hints."""
        from full_frames.ocr_service import process_video_with_gpu_and_ocr_service

        # Test with Chinese language hint
        db_path = tmp_path / "ocr_chinese.db"

        total_boxes = process_video_with_gpu_and_ocr_service(
            video_path=test_video_path,
            db_path=db_path,
            rate_hz=0.1,
            language="zh-Hans",
        )

        assert db_path.exists(), "Database should be created"
        assert total_boxes >= 0, "Should complete without error"

        print(f"\n=== OCR with Chinese Language Hint ===")
        print(f"Total boxes: {total_boxes}")


@pytest.mark.gpu
@pytest.mark.integration
class TestGPUErrorHandling:
    """Integration tests for GPU error handling and retry logic."""

    def test_handles_invalid_video_path(self, tmp_path):
        """Test error handling for non-existent video file."""
        from full_frames.frames_gpu import extract_frames_gpu

        output_dir = tmp_path / "frames"
        output_dir.mkdir()

        non_existent_video = tmp_path / "does_not_exist.mp4"

        with pytest.raises(FileNotFoundError):
            extract_frames_gpu(
                video_path=non_existent_video,
                output_dir=output_dir,
                rate_hz=0.1,
            )

    def test_handles_invalid_crop_region(self, test_video_path, tmp_path):
        """Test error handling for invalid crop region."""
        from full_frames.frames_gpu import extract_frames_gpu

        output_dir = tmp_path / "frames"
        output_dir.mkdir()

        # Crop region larger than video (should fail or auto-clip)
        invalid_crop = (0, 0, 9999, 9999)

        # This might succeed (auto-clipping) or raise an error
        # Just verify it doesn't crash without meaningful error
        try:
            frames = extract_frames_gpu(
                video_path=test_video_path,
                output_dir=output_dir,
                rate_hz=0.1,
                crop_box=invalid_crop,
            )
            # If it succeeds, verify frames were extracted
            assert len(frames) > 0
        except (ValueError, RuntimeError) as e:
            # Expected error types for invalid crop
            assert "crop" in str(e).lower() or "dimension" in str(e).lower()


def test_placeholder_for_test_discovery():
    """Placeholder test to ensure pytest discovers this file."""
    assert True, "Test file loaded successfully"
