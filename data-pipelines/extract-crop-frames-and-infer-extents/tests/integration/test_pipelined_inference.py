"""Integration test for pipelined crop_and_infer implementation.

This test validates the pipelined implementation with parallel VP9 encoding and Wasabi uploads:
1. Sets up test tenant directory structure on Wasabi
2. Copies test fixture video to tenant's client directory
3. Creates and uploads minimal layout.db with crop region
4. Runs the pipelined crop_and_infer Modal function and validates results
5. Cleans up test data (automatic in teardown)

Prerequisites:
- Test fixture videos at:
  - test-fixtures/videos/short-test.mp4 (18s, ~184 frames)
  - test-fixtures/videos/car-teardown-comparison-08.mp4 (full length)
- Modal deployment with crop_and_infer_caption_frame_extents function
- Wasabi credentials configured

TODO: The test fixture does not yet include a valid OCR image or correct layout metadata.
      Once these are added, include coverage for the correct label inferences.

Usage:
    # Run with short video and batch_size=64 (default)
    pytest tests/integration/test_pipelined_inference.py --run-modal

    # Run with full video
    pytest tests/integration/test_pipelined_inference.py --run-modal --full-video

    # Run with custom batch size
    pytest tests/integration/test_pipelined_inference.py --run-modal --batch-size 128

    # Run with full video and custom batch size
    pytest tests/integration/test_pipelined_inference.py --run-modal --full-video --batch-size 16
"""

import gzip
import io
import shutil
import sqlite3
import sys
import uuid
from pathlib import Path

import pytest
from PIL import Image as PILImage

# Modal and project imports will be done within test functions to avoid import errors


@pytest.fixture
def wasabi_service():
    """Create Wasabi service instance for test setup and cleanup."""
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
def test_ids():
    """Generate unique test tenant and video IDs."""
    return {
        "tenant_id": str(uuid.uuid4()),
        "video_id": str(uuid.uuid4()),
    }


@pytest.fixture
def crop_region():
    """Return the crop region for test fixture videos."""
    from extract_crop_frames_and_infer_extents.models import CropRegion

    return CropRegion(
        crop_left=0.1859398879,
        crop_top=0.8705440901,
        crop_right=0.8155883851,
        crop_bottom=0.9455909944,
    )


@pytest.fixture
def setup_test_video(wasabi_service, test_ids, test_video_fixture, crop_region):
    """Set up test video and layout.db on Wasabi, cleanup after test."""
    from app.config import get_settings

    settings = get_settings()
    tenant_id = test_ids["tenant_id"]
    video_id = test_ids["video_id"]

    # Source fixture and target video key
    fixture_key = f"test-fixtures/videos/{test_video_fixture}"
    video_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

    # Copy fixture video to tenant directory
    wasabi_service.s3_client.copy_object(
        CopySource={"Bucket": settings.wasabi_bucket, "Key": fixture_key},
        Bucket=settings.wasabi_bucket,
        Key=video_key,
    )

    # Create and upload layout.db
    video_width = 640
    video_height = 360

    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        layout_db_path = Path(tmpdir) / "layout.db"

        # Create minimal OCR visualization image
        ocr_viz_img = PILImage.new("RGB", (1, 1), color=(0, 0, 0))
        ocr_viz_buffer = io.BytesIO()
        ocr_viz_img.save(ocr_viz_buffer, format="PNG")
        ocr_viz_blob = ocr_viz_buffer.getvalue()

        # Calculate pixel coordinates
        crop_left_px = int(crop_region.crop_left * video_width)
        crop_top_px = int(crop_region.crop_top * video_height)
        crop_right_px = int(crop_region.crop_right * video_width)
        crop_bottom_px = int(crop_region.crop_bottom * video_height)

        # Create layout.db
        conn = sqlite3.connect(str(layout_db_path))
        conn.executescript(
            f"""
            CREATE TABLE IF NOT EXISTS database_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO database_metadata (id, schema_version) VALUES (1, 1);

            CREATE TABLE IF NOT EXISTS video_layout_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                anchor_type TEXT NOT NULL DEFAULT 'center',
                frame_width INTEGER NOT NULL DEFAULT {video_width},
                frame_height INTEGER NOT NULL DEFAULT {video_height},
                crop_left INTEGER NOT NULL DEFAULT {crop_left_px},
                crop_top INTEGER NOT NULL DEFAULT {crop_top_px},
                crop_right INTEGER NOT NULL DEFAULT {crop_right_px},
                crop_bottom INTEGER NOT NULL DEFAULT {crop_bottom_px},
                ocr_visualization_image BLOB
            );

            CREATE TABLE IF NOT EXISTS video_preferences (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                layout_approved INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO video_preferences (id, layout_approved) VALUES (1, 1);
        """
        )

        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO video_layout_config (id, anchor_type, ocr_visualization_image)
            VALUES (?, ?, ?)
        """,
            (1, "center", ocr_viz_blob),
        )
        conn.commit()
        conn.close()

        # Compress and upload
        layout_db_gz_path = Path(tmpdir) / "layout.db.gz"
        with open(layout_db_path, "rb") as f_in, gzip.open(layout_db_gz_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

        layout_db_gz_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        wasabi_service.upload_from_path(
            key=layout_db_gz_key,
            local_path=layout_db_gz_path,
            content_type="application/gzip",
        )

    yield {"video_key": video_key, "tenant_id": tenant_id, "video_id": video_id}

    # Cleanup: delete all test files
    try:
        wasabi_service.delete_prefix(f"{tenant_id}/")
    except Exception as e:
        print(f"Warning: Failed to clean up Wasabi: {e}")


@pytest.mark.modal
@pytest.mark.integration
def test_pipelined_crop_and_infer(
    setup_test_video,
    crop_region,
    batch_size,
    test_video_fixture,
):
    """Test pipelined crop_and_infer implementation with parallel encoding and uploads."""
    import modal

    video_key = setup_test_video["video_key"]
    tenant_id = setup_test_video["tenant_id"]
    video_id = setup_test_video["video_id"]

    print(f"\n{'=' * 80}")
    print("PIPELINED IMPLEMENTATION INTEGRATION TEST")
    print(f"{'=' * 80}")
    print("Configuration:")
    print(f"  Video: {test_video_fixture}")
    print(f"  Batch size: {batch_size}")
    print(f"  Tenant ID: {tenant_id}")
    print(f"  Video ID: {video_id}")
    print(f"{'=' * 80}\n")

    # Look up deployed Modal function
    crop_and_infer_fn = modal.Function.from_name(
        app_name="extract-crop-frames-and-infer-extents", name="crop_and_infer_caption_frame_extents"
    )

    # Call Modal function
    print("Spawning Modal function call...")
    print(f"Parameters: frame_rate=10.0, encoder_workers=4, inference_batch_size={batch_size}\n")

    result_call = crop_and_infer_fn.spawn(
        video_key=video_key,
        tenant_id=tenant_id,
        video_id=video_id,
        crop_region=crop_region,
        frame_rate=10.0,
        encoder_workers=4,
        inference_batch_size=batch_size,
    )

    print("Waiting for completion...")
    print("(Check Modal dashboard for live progress)\n")

    result = result_call.get()

    # Validate results
    print(f"{'=' * 80}")
    print("VALIDATION")
    print(f"{'=' * 80}\n")

    assert result.version >= 1, "Version should be >= 1"
    assert result.frame_count > 0, "Should have extracted frames"
    assert result.label_counts, "Should have label counts"
    assert result.processing_duration_seconds > 0, "Processing duration should be positive"
    assert result.cropped_frames_prefix, "Should have cropped frames prefix"
    assert result.caption_frame_extents_db_key, "Should have database key"

    # Validate label counts structure
    expected_labels = {"same", "different", "empty_empty", "empty_valid", "valid_empty"}
    actual_labels = set(result.label_counts.keys())
    assert actual_labels.issubset(
        expected_labels
    ), f"Unexpected labels: {actual_labels - expected_labels}"

    print("✓ All validations passed!")
    print()
    print("Results:")
    print(f"  • Version: {result.version}")
    print(f"  • Frame count: {result.frame_count}")
    print(f"  • Label counts: {result.label_counts}")
    print(f"  • Processing duration: {result.processing_duration_seconds:.2f}s")
    print(f"  • Cropped frames prefix: {result.cropped_frames_prefix}")
    print(f"  • Caption frame extents DB: {result.caption_frame_extents_db_key}")
    print()

    # Calculate and display throughput
    if result.processing_duration_seconds > 0:
        throughput = result.frame_count / result.processing_duration_seconds
        print(f"Overall throughput: {throughput:.1f} frames/second")
    print()

    print(f"{'=' * 80}")
    print("TEST COMPLETE")
    print(f"{'=' * 80}\n")


if __name__ == "__main__":
    # Allow running directly with python for backward compatibility
    print("This test should be run with pytest:")
    print("  pytest tests/integration/test_pipelined_inference.py --run-modal")
    print("  pytest tests/integration/test_pipelined_inference.py --run-modal --full-video")
    print("  pytest tests/integration/test_pipelined_inference.py --run-modal --batch-size 64")
    sys.exit(1)
