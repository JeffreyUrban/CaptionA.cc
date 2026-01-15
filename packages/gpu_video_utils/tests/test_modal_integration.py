"""Integration tests for GPU video utils running on Modal A10G hardware.

These tests invoke Modal functions that run on GPU hardware, similar to captionacc-modal tests.

Prerequisites:
- Test fixture videos at:
  - test-fixtures/videos/short-test.mp4 (18s, ~184 frames)
  - test-fixtures/videos/car-teardown-comparison-08.mp4 (full length)
- Modal deployment with gpu-video-utils-tests app
- Wasabi credentials configured

Usage:
    # Run with short video (default)
    pytest tests/test_modal_integration.py --run-modal

    # Run with full video
    pytest tests/test_modal_integration.py --run-modal --full-video
"""

import sys
from pathlib import Path

import pytest

# Modal imports will be done within test functions to avoid import errors


@pytest.fixture
def wasabi_service():
    """Create Wasabi service instance for test video download."""
    # Import here to avoid issues if dependencies aren't available
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent / "services" / "api"))
    from app.config import get_settings
    from app.services.wasabi_service import WasabiServiceImpl

    settings = get_settings()
    return WasabiServiceImpl(
        access_key=settings.effective_wasabi_access_key,
        secret_key=settings.effective_wasabi_secret_key,
        bucket=settings.wasabi_bucket,
        region=settings.wasabi_region,
    )


@pytest.fixture
def test_video_bytes(request, wasabi_service):
    """Download test video from Wasabi and return as bytes."""
    # Select test video based on --full-video flag
    if request.config.getoption("--full-video"):
        fixture_key = "test-fixtures/videos/car-teardown-comparison-08.mp4"
    else:
        fixture_key = "test-fixtures/videos/short-test.mp4"

    # Download video
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        local_path = Path(f.name)

    try:
        wasabi_service.download_file(fixture_key, local_path)
        with open(local_path, "rb") as f:
            return f.read()
    finally:
        if local_path.exists():
            local_path.unlink()


@pytest.mark.modal
@pytest.mark.integration
class TestGPUVideoUtilsModal:
    """Integration tests running on Modal A10G GPU."""

    def test_decoder_basic_modal(self, test_video_bytes):
        """Test basic decoder functionality on Modal GPU."""
        import modal

        # Look up deployed Modal function
        test_fn = modal.Function.from_name(app_name="gpu-video-utils-tests", name="test_decoder_basic")

        print("\n" + "=" * 80)
        print("GPU DECODER BASIC TEST")
        print("=" * 80)
        print(f"Video size: {len(test_video_bytes) / 1024 / 1024:.1f} MB")
        print("Running on Modal A10G GPU...\n")

        # Call Modal function
        result_call = test_fn.spawn(video_bytes=test_video_bytes)
        result = result_call.get()

        print("Results:")
        print(f"  • Total frames: {result['total_frames']}")
        print(f"  • FPS: {result['fps']:.2f}")
        print(f"  • Dimensions: {result['width']}x{result['height']}")
        print(f"  • Duration: {result['duration']:.2f}s")
        print(f"  • Frame shape: {result['frame_0_shape']}")
        print(f"  • GPU device: {result['gpu_device']}")

        # Assertions
        assert result["success"], "Test should succeed"
        assert result["total_frames"] > 0, "Should have frames"
        assert result["fps"] > 0, "FPS should be positive"
        assert result["gpu_device"] == "cuda", "Frames should be on CUDA"
        assert result["frame_0_shape"][2] == 3, "Should have RGB channels"

        print("\n✓ Test passed!")
        print("=" * 80 + "\n")

    def test_frame_extraction_modal(self, test_video_bytes):
        """Test frame extraction on Modal GPU."""
        import modal

        test_fn = modal.Function.from_name(app_name="gpu-video-utils-tests", name="test_frame_extraction")

        print("\n" + "=" * 80)
        print("GPU FRAME EXTRACTION TEST")
        print("=" * 80)
        print("Testing extraction in tensor, PIL, and JPEG formats...")
        print("Running on Modal A10G GPU...\n")

        # Call Modal function
        result_call = test_fn.spawn(video_bytes=test_video_bytes, frame_rate_hz=0.1)
        result = result_call.get()

        print("Results:")
        print(f"  • Frame rate: {result['frame_rate_hz']} Hz")
        print(f"  • Tensor frames: {result['tensor_count']}")
        print(f"  • PIL frames: {result['pil_count']}")
        print(f"  • JPEG frames: {result['jpeg_count']}")
        print(f"  • Tensor shape: {result['first_tensor_shape']}")
        print(f"  • GPU device: {result['first_tensor_gpu']}")
        print(f"  • First JPEG size: {result['first_jpeg_size_bytes']} bytes")

        # Assertions
        assert result["success"], "Test should succeed"
        assert result["tensor_count"] == result["pil_count"] == result["jpeg_count"], (
            "All formats should extract same number of frames"
        )
        assert result["tensor_count"] > 0, "Should extract frames"
        assert result["first_tensor_gpu"] == "cuda", "Tensors should be on GPU"
        assert result["first_jpeg_size_bytes"] > 0, "JPEG should have content"

        print("\n✓ Test passed!")
        print("=" * 80 + "\n")

    def test_frame_extraction_with_crop_modal(self, test_video_bytes):
        """Test GPU cropping on Modal."""
        import modal

        test_fn = modal.Function.from_name(app_name="gpu-video-utils-tests", name="test_frame_extraction_with_crop")

        print("\n" + "=" * 80)
        print("GPU CROPPING TEST")
        print("=" * 80)
        print("Testing center 50% crop...")
        print("Running on Modal A10G GPU...\n")

        # Call Modal function
        result_call = test_fn.spawn(video_bytes=test_video_bytes)
        result = result_call.get()

        print("Results:")
        print(f"  • Original size: {result['original_size']}")
        print(f"  • Crop region: {result['crop_region']}")
        print(f"  • Expected size: {result['expected_size']}")
        print(f"  • Actual size: {result['actual_size']}")
        print(f"  • Frame count: {result['frame_count']}")
        print(f"  • Crop correct: {result['crop_correct']}")

        # Assertions
        assert result["success"], "Test should succeed"
        assert result["crop_correct"], "Crop dimensions should match expected"
        assert result["frame_count"] > 0, "Should extract frames"

        print("\n✓ Test passed!")
        print("=" * 80 + "\n")

    def test_error_handling_modal(self, test_video_bytes):
        """Test error handling and retry logic on Modal."""
        import modal

        test_fn = modal.Function.from_name(app_name="gpu-video-utils-tests", name="test_error_handling")

        print("\n" + "=" * 80)
        print("GPU ERROR HANDLING TEST")
        print("=" * 80)
        print("Testing invalid index and timestamp clamping...")
        print("Running on Modal A10G GPU...\n")

        # Call Modal function
        result_call = test_fn.spawn(video_bytes=test_video_bytes)
        result = result_call.get()

        print("Results:")
        print(f"  • Total frames: {result['total_frames']}")
        print(f"  • Invalid index raised error: {result['invalid_index_raised_error']}")
        print(f"  • Timestamp clamping works: {result['timestamp_clamping_works']}")

        # Assertions
        assert result["success"], "Test should succeed"
        assert result["invalid_index_raised_error"], "Should raise error for invalid index"
        assert result["timestamp_clamping_works"], "Should clamp timestamps gracefully"

        print("\n✓ Test passed!")
        print("=" * 80 + "\n")

    def test_montage_batching_modal(self, test_video_bytes):
        """Test montage batching on Modal."""
        import modal

        test_fn = modal.Function.from_name(app_name="gpu-video-utils-tests", name="test_montage_batching")

        print("\n" + "=" * 80)
        print("GPU MONTAGE BATCHING TEST")
        print("=" * 80)
        print("Testing frame batching for montage assembly...")
        print("Running on Modal A10G GPU...\n")

        # Call Modal function
        result_call = test_fn.spawn(video_bytes=test_video_bytes)
        result = result_call.get()

        print("Results:")
        print(f"  • Number of batches: {result['num_batches']}")
        print(f"  • Max batch size: {result['max_batch_size']}")
        print("  • Batch details:")
        for i, batch in enumerate(result["batch_info"][:3]):  # Show first 3
            print(
                f"    - Batch {i}: {batch['num_frames']} frames, "
                f"indices {batch['first_index']}-{batch['last_index']}, "
                f"all JPEG: {batch['all_jpeg']}"
            )

        # Assertions
        assert result["success"], "Test should succeed"
        assert result["num_batches"] > 0, "Should create batches"
        assert result["max_batch_size"] <= 10, "Batch size should respect limit"
        assert all(b["all_jpeg"] for b in result["batch_info"]), "All frames should be JPEG encoded"

        print("\n✓ Test passed!")
        print("=" * 80 + "\n")


def test_placeholder_for_test_discovery():
    """Placeholder test to ensure pytest discovers this file."""
    assert True, "Test file loaded successfully"
