"""Integration test for full_frames GPU + OCR implementation.

This test validates the complete GPU-accelerated full frame extraction and OCR pipeline:
1. Sets up test tenant directory structure on Wasabi
2. Copies test fixture video to tenant's client directory
3. Runs the extract_frames_and_ocr Modal function and validates results
4. Cleans up test data (automatic in teardown)

Prerequisites:
- Test fixture videos at:
  - test-fixtures/videos/short-test.mp4 (18s, ~184 frames)
  - test-fixtures/videos/car-teardown-comparison-08.mp4 (full length)
- Modal deployment with extract_frames_and_ocr function
- Wasabi credentials configured
- OCR service running and accessible from Modal
- Google Cloud credentials configured in Modal

Usage:
    # Run with short video (default)
    pytest tests/test_full_frames_modal_integration.py --run-modal

    # Run with full video
    pytest tests/test_full_frames_modal_integration.py --run-modal --full-video
"""

import sys
import uuid
from pathlib import Path

import pytest


@pytest.fixture
def wasabi_service():
    """Create Wasabi service instance for test setup and cleanup."""
    # Import here to avoid issues if dependencies aren't available
    sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "services" / "api"))
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
def test_ids():
    """Generate unique test tenant and video IDs."""
    return {
        "tenant_id": str(uuid.uuid4()),
        "video_id": str(uuid.uuid4()),
    }


@pytest.fixture
def setup_test_video(wasabi_service, test_ids, request):
    """Set up test video on Wasabi, cleanup after test."""
    from app.config import get_settings

    settings = get_settings()
    tenant_id = test_ids["tenant_id"]
    video_id = test_ids["video_id"]

    # Select test video based on --full-video flag
    if request.config.getoption("--full-video"):
        test_video_fixture = "car-teardown-comparison-08.mp4"
    else:
        test_video_fixture = "short-test.mp4"

    # Source fixture and target video key
    fixture_key = f"test-fixtures/videos/{test_video_fixture}"
    video_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

    # Copy fixture video to tenant directory
    wasabi_service.s3_client.copy_object(
        CopySource={"Bucket": settings.wasabi_bucket, "Key": fixture_key},
        Bucket=settings.wasabi_bucket,
        Key=video_key,
    )

    yield {
        "video_key": video_key,
        "tenant_id": tenant_id,
        "video_id": video_id,
        "test_video_fixture": test_video_fixture,
    }

    # Cleanup: delete all test files
    try:
        wasabi_service.delete_prefix(f"{tenant_id}/")
    except Exception as e:
        print(f"Warning: Failed to clean up Wasabi: {e}")


@pytest.mark.modal
@pytest.mark.integration
def test_full_frames_gpu_ocr_pipeline(setup_test_video):
    """Test complete GPU extraction → OCR → database pipeline on Modal."""
    import modal

    video_key = setup_test_video["video_key"]
    tenant_id = setup_test_video["tenant_id"]
    video_id = setup_test_video["video_id"]
    test_video_fixture = setup_test_video["test_video_fixture"]

    print(f"\n{'=' * 80}")
    print("FULL FRAMES GPU + OCR PIPELINE INTEGRATION TEST")
    print(f"{'=' * 80}")
    print(f"Configuration:")
    print(f"  Video: {test_video_fixture}")
    print(f"  Tenant ID: {tenant_id}")
    print(f"  Video ID: {video_id}")
    print(f"{'=' * 80}\n")

    # Look up deployed Modal function
    extract_fn = modal.Function.from_name(
        app_name="extract-full-frames-and-ocr", name="extract_frames_and_ocr"
    )

    # Call Modal function
    print("Spawning Modal function call...")
    print(f"Parameters: rate_hz=0.1, language=en\n")

    result_call = extract_fn.spawn(
        video_key=video_key,
        tenant_id=tenant_id,
        video_id=video_id,
        rate_hz=0.1,
        language="en",
    )

    print("Waiting for completion...")
    print("(Check Modal dashboard for live progress)\n")

    result = result_call.get()

    # Validate results
    print(f"{'=' * 80}")
    print("VALIDATION")
    print(f"{'=' * 80}\n")

    assert result["version"] == 1, "Version should be 1"
    assert result["frame_count"] > 0, "Should have extracted frames"
    assert result["total_ocr_boxes"] >= 0, "Should return OCR box count"
    assert result["processing_duration_seconds"] > 0, "Processing duration should be positive"
    assert result["fullOCR_db_key"], "Should have database key"
    assert result["full_frames_prefix"], "Should have frames prefix"

    # Expected keys
    expected_db_key = f"{tenant_id}/server/videos/{video_id}/fullOCR.db"
    expected_frames_prefix = f"{tenant_id}/client/videos/{video_id}/full_frames/"

    assert result["fullOCR_db_key"] == expected_db_key, f"Database key should be {expected_db_key}"
    assert result["full_frames_prefix"] == expected_frames_prefix, f"Frames prefix should be {expected_frames_prefix}"

    print("✓ All validations passed!")
    print()
    print("Results:")
    print(f"  • Version: {result['version']}")
    print(f"  • Frame count: {result['frame_count']}")
    print(f"  • Total OCR boxes: {result['total_ocr_boxes']}")
    print(f"  • Processing duration: {result['processing_duration_seconds']:.2f}s")
    print(f"  • Database key: {result['fullOCR_db_key']}")
    print(f"  • Frames prefix: {result['full_frames_prefix']}")
    print()

    # Calculate and display throughput
    if result["processing_duration_seconds"] > 0:
        throughput = result["frame_count"] / result["processing_duration_seconds"]
        print(f"Overall throughput: {throughput:.2f} frames/second")
    print()

    print(f"{'=' * 80}")
    print("TEST COMPLETE")
    print(f"{'=' * 80}\n")


@pytest.mark.modal
@pytest.mark.integration
@pytest.mark.parametrize("rate_hz,language", [
    (0.05, "en"),
    (0.1, "zh-Hans"),
])
def test_different_rates_and_languages(setup_test_video, rate_hz, language):
    """Test pipeline with different frame extraction rates and languages."""
    import modal

    video_key = setup_test_video["video_key"]
    tenant_id = setup_test_video["tenant_id"]
    video_id = setup_test_video["video_id"]

    print(f"\n{'=' * 80}")
    print(f"Testing with {rate_hz} Hz, language={language}")
    print(f"{'=' * 80}\n")

    # Look up deployed Modal function
    extract_fn = modal.Function.from_name(
        app_name="extract-full-frames-and-ocr", name="extract_frames_and_ocr"
    )

    # Call Modal function
    result_call = extract_fn.spawn(
        video_key=video_key,
        tenant_id=tenant_id,
        video_id=video_id,
        rate_hz=rate_hz,
        language=language,
    )

    result = result_call.get()

    print(f"Extracted {result['frame_count']} frames, found {result['total_ocr_boxes']} OCR boxes")

    assert result["version"] == 1, "Version should be 1"
    assert result["frame_count"] > 0, f"Should extract frames at {rate_hz} Hz"
    assert result["total_ocr_boxes"] >= 0, "Should return OCR box count"

    print(f"✓ Test passed!\n")


def test_placeholder_for_test_discovery():
    """Placeholder test to ensure pytest discovers this file."""
    assert True, "Test file loaded successfully"


if __name__ == "__main__":
    # Allow running directly with python for backward compatibility
    print("This test should be run with pytest:")
    print("  pytest tests/test_full_frames_modal_integration.py --run-modal")
    print("  pytest tests/test_full_frames_modal_integration.py --run-modal --full-video")
    sys.exit(1)
