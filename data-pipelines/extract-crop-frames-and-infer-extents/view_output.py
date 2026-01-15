"""
View output from sequential crop_and_infer test.

This script:
1. Runs the test WITHOUT cleanup
2. Downloads sample cropped frames and WebM chunks
3. Opens them for viewing
"""

import sys
import tempfile
import uuid
from pathlib import Path

from PIL import Image as PILImage


def run_test_and_view():
    """Run test and view the output."""
    print("=" * 80)
    print("RUNNING TEST (output will be preserved for viewing)")
    print("=" * 80)
    print()

    # Import Modal Lookup to access deployed function
    import modal
    from extract_crop_frames_and_infer_extents.models import CropRegion

    # Get Wasabi service
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
    fixture_key = "test-fixtures/videos/short-test.mp4"
    video_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

    print(f"Tenant ID: {tenant_id}")
    print(f"Video ID: {video_id}\n")

    try:
        # Copy fixture video
        print("[1/4] Copying fixture video...")
        wasabi.s3_client.copy_object(
            CopySource={"Bucket": settings.wasabi_bucket, "Key": fixture_key},
            Bucket=settings.wasabi_bucket,
            Key=video_key,
        )
        print(f"  ✓ Copied to: {video_key}\n")

        # Create and upload layout.db
        print("[2/4] Creating layout.db...")
        import gzip
        import io
        import shutil
        import sqlite3

        crop_region = CropRegion(
            crop_left=0.1859398879,
            crop_top=0.8705440901,
            crop_right=0.8155883851,
            crop_bottom=0.9455909944,
        )

        video_width = 640
        video_height = 360
        crop_left_px = int(crop_region.crop_left * video_width)
        crop_top_px = int(crop_region.crop_top * video_height)
        crop_right_px = int(crop_region.crop_right * video_width)
        crop_bottom_px = int(crop_region.crop_bottom * video_height)

        with tempfile.TemporaryDirectory() as tmpdir:
            layout_db_path = Path(tmpdir) / "layout.db"

            # Minimal OCR viz
            ocr_viz_img = PILImage.new("RGB", (1, 1), color=(0, 0, 0))
            ocr_viz_buffer = io.BytesIO()
            ocr_viz_img.save(ocr_viz_buffer, format="PNG")
            ocr_viz_blob = ocr_viz_buffer.getvalue()

            # Create layout.db
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

            # Compress
            layout_db_gz_path = Path(tmpdir) / "layout.db.gz"
            with open(layout_db_path, "rb") as f_in, gzip.open(layout_db_gz_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)

            # Upload
            layout_db_gz_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
            wasabi.upload_from_path(
                key=layout_db_gz_key,
                local_path=layout_db_gz_path,
                content_type="application/gzip",
            )

            print(f"  ✓ Uploaded: {layout_db_gz_key}\n")

        # Run Modal function
        print("[3/4] Running Modal function...")
        crop_and_infer_fn = modal.Function.from_name(
            app_name="extract-crop-frames-and-infer-extents", name="crop_and_infer_sequential"
        )

        result_call = crop_and_infer_fn.spawn(
            video_key=video_key,
            tenant_id=tenant_id,
            video_id=video_id,
            crop_region=crop_region,
            frame_rate=10.0,
            encoder_workers=4,
        )
        print("  Waiting for completion...\n")
        result = result_call.get()

        print("✓ Processing complete!")
        print(f"  Frames: {result.frame_count}")
        print(f"  Cropped frames prefix: {result.cropped_frames_prefix}\n")

        # Download and view samples
        print("[4/4] Downloading samples for viewing...")

        # The actual storage location differs from cropped_frames_prefix
        # Real path: {tenant_id}/{video_id}/cropped_frames_v{version}/
        # Not: {tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/
        actual_prefix = f"{tenant_id}/{video_id}/cropped_frames_v{result.version}/"

        print(f"  Searching for chunks at: {actual_prefix}")

        # List all cropped frame chunks
        response = wasabi.s3_client.list_objects_v2(Bucket=settings.wasabi_bucket, Prefix=actual_prefix, MaxKeys=1000)

        if "Contents" not in response:
            print("  ✗ No cropped frames found")
            return

        webm_chunks = [obj["Key"] for obj in response["Contents"] if obj["Key"].endswith(".webm")]
        print(f"  Found {len(webm_chunks)} WebM chunks\n")

        # Download samples
        download_dir = Path.home() / "Downloads" / "captionacc_test_output"
        download_dir.mkdir(exist_ok=True, parents=True)

        # Download first chunk from each modulo level
        downloaded = []
        for chunk_key in sorted(webm_chunks)[:5]:  # First 5 chunks
            filename = Path(chunk_key).name
            local_path = download_dir / filename

            wasabi.download_file(chunk_key, local_path)
            size_kb = local_path.stat().st_size / 1024
            print(f"  ✓ Downloaded: {filename} ({size_kb:.1f} KB)")
            downloaded.append(local_path)

        print(f"\n{'=' * 80}")
        print("FILES READY FOR VIEWING")
        print(f"{'=' * 80}")
        print(f"Location: {download_dir}")
        print("\nDownloaded files:")
        for path in downloaded:
            print(f"  - {path.name}")

        print("\nTo view WebM files:")
        print(f"  • VLC: vlc {downloaded[0]}")
        print(f"  • ffplay: ffplay {downloaded[0]}")
        print(f"  • mpv: mpv {downloaded[0]}")

        print("\nTo extract frames from WebM:")
        print(f"  ffmpeg -i {downloaded[0]} frame_%04d.jpg")

        print(f"\n{'=' * 80}")
        print("TEST DATA PRESERVED")
        print(f"{'=' * 80}")
        print("To clean up later, delete tenant:")
        print(f"  Tenant ID: {tenant_id}")
        print(f"  Wasabi prefix: {tenant_id}/")
        print(f"{'=' * 80}\n")

        # Try to open first file in default video player
        try:
            import platform
            import subprocess

            if platform.system() == "Darwin":  # macOS
                subprocess.run(["open", str(downloaded[0])])
                print(f"✓ Opened {downloaded[0].name} in default player")
            elif platform.system() == "Linux":
                subprocess.run(["xdg-open", str(downloaded[0])])
                print(f"✓ Opened {downloaded[0].name} in default player")
        except Exception as e:
            print(f"Could not auto-open file: {e}")

    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    run_test_and_view()
