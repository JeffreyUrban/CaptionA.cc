"""
Test script for pipelined crop_and_infer implementation.

This script tests ONLY the pipelined crop_and_infer Modal function:
1. Sets up test tenant directory structure on Wasabi
2. Copies test fixture video to tenant's client directory
3. Creates and uploads minimal layout.db with crop region
4. Runs the pipelined crop_and_infer Modal function and displays metrics
5. Cleans up test data (automatic in finally block)

Prerequisites:
- Test fixture video at: test-fixtures/videos/car-teardown-comparison-08.mp4
- Modal deployment with crop_and_infer_caption_frame_extents function
"""

import gzip
import io
import shutil
import sqlite3
import sys
import tempfile
import uuid
from pathlib import Path

from PIL import Image as PILImage


def run_pipelined_test():
    """Run pipelined implementation test."""
    print("=" * 80)
    print("PIPELINED IMPLEMENTATION TEST")
    print("=" * 80)
    print()

    # Import Modal Lookup to access deployed function
    import modal
    from captionacc_modal.models import CropRegion

    # Get Wasabi service for setup and cleanup
    sys.path.insert(0, str(Path(__file__).parent.parent.parent / "services" / "api"))
    from app.config import get_settings
    from app.services.wasabi_service import WasabiServiceImpl

    settings = get_settings()
    wasabi = WasabiServiceImpl(
        access_key=settings.effective_wasabi_access_key,
        secret_key=settings.effective_wasabi_secret_key,
        bucket=settings.wasabi_bucket,
        region=settings.wasabi_region,
    )

    # Generate test IDs
    tenant_id = str(uuid.uuid4())
    video_id = str(uuid.uuid4())

    # Source fixture and target video key
    fixture_key = "test-fixtures/videos/car-teardown-comparison-08.mp4"
    video_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

    print(f"[1/4] Setting up test tenant directory")
    print(f"  Tenant ID: {tenant_id}")
    print(f"  Video ID: {video_id}")
    print(f"  Source fixture: {fixture_key}")
    print(f"  Target video key: {video_key}\n")

    # Step 2: Copy fixture video to tenant directory
    print("[2/4] Copying fixture video to tenant directory...")
    try:
        # Copy the fixture video to the tenant's client directory
        wasabi.s3_client.copy_object(
            CopySource={"Bucket": settings.wasabi_bucket, "Key": fixture_key},
            Bucket=settings.wasabi_bucket,
            Key=video_key,
        )
        print(f"  Video copied to: {video_key}\n")
    except Exception as e:
        print(f"✗ Error copying video: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 3: Create and upload minimal layout.db with crop region
    print("[3/4] Creating and uploading layout.db with crop region...")

    # Define crop region (caption area for test fixture)
    # Video is 640x360 (from car-teardown-comparison-08.mp4)
    video_width = 640
    video_height = 360

    crop_region = CropRegion(
        crop_left=0.1859398879,
        crop_top=0.8705440901,
        crop_right=0.8155883851,
        crop_bottom=0.9455909944,
    )

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            layout_db_path = Path(tmpdir) / "layout.db"

            # Create a minimal OCR visualization image (1x1 pixel black image)
            ocr_viz_img = PILImage.new('RGB', (1, 1), color=(0, 0, 0))
            ocr_viz_buffer = io.BytesIO()
            ocr_viz_img.save(ocr_viz_buffer, format='PNG')
            ocr_viz_blob = ocr_viz_buffer.getvalue()

            # Calculate pixel coordinates from normalized crop region
            crop_left_px = int(crop_region.crop_left * video_width)
            crop_top_px = int(crop_region.crop_top * video_height)
            crop_right_px = int(crop_region.crop_right * video_width)
            crop_bottom_px = int(crop_region.crop_bottom * video_height)

            # Create minimal layout.db with schema and crop region
            conn = sqlite3.connect(str(layout_db_path))
            conn.executescript(f"""
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
            """)

            # Insert the layout config with OCR visualization
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO video_layout_config (id, anchor_type, ocr_visualization_image)
                VALUES (?, ?, ?)
            """, (1, 'center', ocr_viz_blob))

            conn.commit()
            conn.close()

            # Compress to .gz format
            layout_db_gz_path = Path(tmpdir) / "layout.db.gz"
            with open(layout_db_path, 'rb') as f_in:
                with gzip.open(layout_db_gz_path, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)

            # Upload compressed version only
            layout_db_gz_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"

            wasabi.upload_from_path(
                key=layout_db_gz_key,
                local_path=layout_db_gz_path,
                content_type="application/gzip",
            )

            print(f"  Layout.db.gz uploaded to: {layout_db_gz_key}")
            print(f"  Video dimensions: {video_width}x{video_height}")
            print(f"  Crop region (normalized): L={crop_region.crop_left:.4f}, T={crop_region.crop_top:.4f}, "
                  f"R={crop_region.crop_right:.4f}, B={crop_region.crop_bottom:.4f}")
            print(f"  Crop region (pixels): L={crop_left_px}, T={crop_top_px}, "
                  f"R={crop_right_px}, B={crop_bottom_px}\n")
    except Exception as e:
        print(f"✗ Error creating layout.db: {e}")
        import traceback
        traceback.print_exc()
        return False

    # Step 4: Run pipelined crop_and_infer
    print("[4/4] Running PIPELINED crop_and_infer_caption_frame_extents...")
    print("=" * 80)

    try:
        # Look up the deployed Modal function
        print("  Looking up deployed Modal function...")
        crop_and_infer_fn = modal.Function.from_name(
            app_name="captionacc-processing",
            name="crop_and_infer_caption_frame_extents"
        )

        # Call Modal function with the tenant video key
        print("  Spawning Modal function call...")
        result_call = crop_and_infer_fn.spawn(
            video_key=video_key,
            tenant_id=tenant_id,
            video_id=video_id,
            crop_region=crop_region,
            frame_rate=10.0,  # 10 Hz
            encoder_workers=4,  # 4 parallel encoding workers
        )
        print("  Modal function dispatched, waiting for completion...")
        print("  (Check Modal dashboard for live progress)\n")
        result = result_call.get()

        print("=" * 80)
        print()
        print("✓ Pipelined implementation completed successfully!")
        print()
        print("Results:")
        print(f"  • Version: {result['version']}")
        print(f"  • Frame count: {result['frame_count']}")
        print(f"  • Label counts: {result['label_counts']}")
        print(f"  • Processing duration: {result['processing_duration_seconds']:.2f}s")
        print(f"  • Cropped frames prefix: {result['cropped_frames_prefix']}")
        print(f"  • Caption frame extents DB: {result['caption_frame_extents_db_key']}")
        print()

        # Calculate throughput
        if result['processing_duration_seconds'] > 0:
            throughput = result['frame_count'] / result['processing_duration_seconds']
            print(f"Overall throughput: {throughput:.1f} frames/second")
        print()

    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        print("\nCleaning up test data...")
        try:
            # Delete all test files from Wasabi with the tenant prefix
            deleted_count = wasabi.delete_prefix(f"{tenant_id}/")
            print(f"  Deleted {deleted_count} test files from Wasabi")
        except Exception as e:
            print(f"  Warning: Failed to clean up Wasabi: {e}")

    print()
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)
    print()
    print("Check Modal dashboard for detailed performance metrics:")
    print("https://modal.com/apps")
    return True


if __name__ == "__main__":
    success = run_pipelined_test()
    sys.exit(0 if success else 1)
