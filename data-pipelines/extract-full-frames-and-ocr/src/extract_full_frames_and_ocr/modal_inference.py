"""Modal function for GPU-accelerated full frame extraction and OCR processing.

This function:
1. Downloads video from Wasabi
2. Extracts frames at specified rate using GPU acceleration
3. Processes frames with OCR service (montage assembly + Google Vision API)
4. Creates two databases:
   - raw-ocr.db (server-only): full_frame_ocr table with complete OCR results
   - layout.db (client-facing): boxes, layout_config, preferences tables
5. Uploads both databases to Wasabi
6. Returns statistics and storage keys
"""

import tempfile
import time
from pathlib import Path

try:
    import modal
except ImportError:
    modal = None


def get_full_frames_image():
    """Get Modal image with full_frames dependencies."""
    if not modal:
        return None

    # Get repo root - this file is in data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/
    from pathlib import Path

    repo_root = Path(__file__).parent.parent.parent.parent.parent

    return (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("libgl1-mesa-glx", "libglib2.0-0", "ffmpeg")
        .pip_install(
            # GPU Video Processing
            "PyNvVideoCodec",
            "torch>=2.0.0",
            # Core dependencies
            "numpy>=1.24.0",
            "Pillow>=10.0.0",
            "opencv-python-headless",  # For frames_db
            "pydantic>=2.0.0",  # Required by local packages
            "sqlalchemy>=2.0.0",  # Required by frames_db
            "ffmpeg-python",  # For video metadata extraction
            # OCR and storage
            "google-cloud-vision>=3.0.0",
            "boto3",  # For Wasabi S3
        )
        .env({"PYTHONPATH": "/root"})
        # Add local packages
        .add_local_dir(
            repo_root / "packages" / "gpu_video_utils" / "src" / "gpu_video_utils",
            remote_path="/root/gpu_video_utils",
        )
        .add_local_dir(
            repo_root / "packages" / "ocr" / "src" / "ocr", remote_path="/root/ocr"
        )
        .add_local_dir(
            repo_root / "packages" / "frames_db" / "src" / "frames_db",
            remote_path="/root/frames_db",
        )
        .add_local_dir(
            repo_root
            / "data-pipelines"
            / "extract-full-frames-and-ocr"
            / "src"
            / "extract_full_frames_and_ocr",
            remote_path="/root/extract_full_frames_and_ocr",
        )
    )


def extract_frames_and_ocr_impl(
    video_key: str,
    tenant_id: str,
    video_id: str,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
) -> dict:
    """Extract frames with GPU and process with OCR service.

    Args:
        video_key: Wasabi S3 key for video file
        tenant_id: Tenant UUID for path scoping
        video_id: Video UUID
        rate_hz: Frame extraction rate in Hz (default: 0.1 = 1 frame per 10s)
        language: OCR language hint (default: "zh-Hans")

    Returns:
        Dict with:
            - version: Result version (1)
            - frame_count: Number of frames extracted
            - duration: Video duration in seconds
            - frame_width: Video frame width
            - frame_height: Video frame height
            - video_codec: Video codec name
            - bitrate: Video bitrate
            - ocr_box_count: Total OCR text boxes detected
            - failed_ocr_count: Number of frames that failed OCR
            - processing_duration_seconds: Total processing time
            - full_frames_key: Wasabi S3 prefix for frame images
            - ocr_db_key: Wasabi S3 key for fullOCR.db (server-only)
            - layout_db_key: Wasabi S3 key for layout.db (client-facing)

    Raises:
        ValueError: Invalid parameters
        RuntimeError: Processing error

    Wasabi Outputs:
        - {tenant_id}/client/videos/{video_id}/full_frames/frame_NNNNNNNNNN.jpg
        - {tenant_id}/server/videos/{video_id}/raw-ocr.db (server-only, full OCR data)
        - {tenant_id}/client/videos/{video_id}/layout.db (client-facing, boxes + config)
    """
    import os

    import boto3

    # Get S3 client from environment (set via Modal secrets)
    region = os.getenv("WASABI_REGION", "us-east-1")
    wasabi_client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{region}.wasabisys.com",
        aws_access_key_id=os.getenv("WASABI_ACCESS_KEY_READWRITE"),
        aws_secret_access_key=os.getenv("WASABI_SECRET_KEY_READWRITE"),
        region_name=region,
    )
    bucket_name = os.getenv("WASABI_BUCKET")

    job_start = time.time()

    print(f"\n{'=' * 80}")
    print("Starting Full Frames GPU + OCR Job")
    print(f"{'=' * 80}")
    print(f"Video: {video_key}")
    print(f"Tenant: {tenant_id}")
    print(f"Video ID: {video_id}")
    print(f"Frame Rate: {rate_hz} Hz")
    print(f"Language: {language}")
    print(f"{'=' * 80}\n")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Step 1: Download video from Wasabi
        print("[1/7] Downloading video from Wasabi...")
        download_start = time.time()
        video_path = tmp_path / "video.mp4"
        wasabi_client.download_file(bucket_name, video_key, str(video_path))
        print(f"  Downloaded in {time.time() - download_start:.2f}s\n")

        # Step 2: Extract frames with GPU
        print("[2/7] Extracting frames with GPU...")
        from gpu_video_utils import extract_frames_gpu, GPUVideoDecoder

        # Get video info
        decoder = GPUVideoDecoder(video_path)
        video_info = decoder.get_video_info()
        print(f"  Duration: {video_info['duration']:.1f}s")
        print(f"  Dimensions: {video_info['width']}x{video_info['height']}")
        print(f"  FPS: {video_info['fps']:.2f}")

        # Extract frames
        jpeg_frames = extract_frames_gpu(
            video_path=video_path,
            frame_rate_hz=rate_hz,
            output_format="jpeg_bytes",
        )
        print(f"  Extracted {len(jpeg_frames)} frames\n")

        # Step 3: Start frame upload in background (runs in parallel with Steps 4-7)
        print("[3/7] Starting frame and thumbnail upload to Wasabi (background)...")
        import threading
        from PIL import Image
        import io

        # Upload function to run in background
        upload_error = None

        def upload_frames_background():
            nonlocal upload_error
            try:
                upload_start = time.time()
                frames_prefix = f"{tenant_id}/client/videos/{video_id}/full_frames"
                thumbnails_prefix = (
                    f"{tenant_id}/client/videos/{video_id}/full_frames_thumbnails"
                )

                for frame_num, jpeg_bytes in enumerate(jpeg_frames):
                    # Calculate frame index (matching pipeline logic)
                    timestamp = frame_num / rate_hz
                    frame_index = int(timestamp * 10)
                    frame_filename = f"frame_{frame_index:06d}.jpg"

                    # Upload full frame
                    frame_key = f"{frames_prefix}/{frame_filename}"
                    wasabi_client.put_object(
                        Bucket=bucket_name,
                        Key=frame_key,
                        Body=jpeg_bytes,
                        ContentType="image/jpeg",
                    )

                    # Generate and upload thumbnail (320px width)
                    img = Image.open(io.BytesIO(jpeg_bytes))

                    # Calculate thumbnail dimensions maintaining aspect ratio
                    target_width = 320
                    aspect_ratio = img.height / img.width
                    target_height = int(target_width * aspect_ratio)

                    # Resize with high-quality Lanczos filter
                    thumbnail = img.resize(
                        (target_width, target_height), Image.Resampling.LANCZOS
                    )

                    # Save thumbnail to bytes
                    thumbnail_buffer = io.BytesIO()
                    thumbnail.save(
                        thumbnail_buffer, format="JPEG", quality=85, optimize=True
                    )
                    thumbnail_bytes = thumbnail_buffer.getvalue()

                    # Upload thumbnail
                    thumbnail_key = f"{thumbnails_prefix}/{frame_filename}"
                    wasabi_client.put_object(
                        Bucket=bucket_name,
                        Key=thumbnail_key,
                        Body=thumbnail_bytes,
                        ContentType="image/jpeg",
                    )

                    if (frame_num + 1) % 10 == 0 or frame_num == len(jpeg_frames) - 1:
                        print(
                            f"  [Background] Uploaded {frame_num + 1}/{len(jpeg_frames)} frames + thumbnails..."
                        )

                print(
                    f"  [Background] All frames and thumbnails uploaded in {time.time() - upload_start:.2f}s"
                )
            except Exception as e:
                upload_error = e
                print(f"  [Background] Frame upload ERROR: {e}")

        # Start upload thread (non-daemon so we can join before exit)
        upload_thread = threading.Thread(target=upload_frames_background, daemon=False)
        upload_thread.start()

        # Step 4: Process OCR in main thread
        print("[4/7] Processing frames with OCR...")
        db_path = tmp_path / "fullOCR.db"

        from extract_full_frames_and_ocr.pipeline import process_frames_with_ocr_only

        ocr_start = time.time()
        total_boxes, failed_ocr_count = process_frames_with_ocr_only(
            jpeg_frames=jpeg_frames,
            db_path=db_path,
            rate_hz=rate_hz,
            language=language,
        )
        print(f"  OCR processing complete in {time.time() - ocr_start:.2f}s")
        print(f"  Detected {total_boxes} OCR boxes ({failed_ocr_count} failed)\n")

        # Step 5: Create layout.db with boxes table (client-facing)
        print("[5/7] Creating layout.db for client...")
        layout_db_path = tmp_path / "layout.db"

        import sqlite3

        # Get frame count from OCR database
        ocr_conn_temp = sqlite3.connect(str(db_path))
        cursor = ocr_conn_temp.execute(
            "SELECT COUNT(DISTINCT frame_index) FROM full_frame_ocr"
        )
        frame_count = cursor.fetchone()[0]
        ocr_conn_temp.close()

        layout_conn = sqlite3.connect(str(layout_db_path))
        try:
            # Create database_metadata table
            layout_conn.execute(
                """
                CREATE TABLE database_metadata (
                    id INTEGER PRIMARY KEY CHECK(id = 1),
                    schema_version INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            layout_conn.execute(
                "INSERT INTO database_metadata (id, schema_version, created_at) VALUES (1, 1, datetime('now'))"
            )

            # Create boxes table (transformed from full_frame_ocr)
            # DEFAULT values required for CR-SQLite compatibility (v0.16.1+)
            layout_conn.execute(
                """
                CREATE TABLE boxes (
                    frame_index INTEGER NOT NULL,
                    box_index INTEGER NOT NULL,
                    bbox_left REAL NOT NULL DEFAULT 0.0,
                    bbox_top REAL NOT NULL DEFAULT 0.0,
                    bbox_right REAL NOT NULL DEFAULT 0.0,
                    bbox_bottom REAL NOT NULL DEFAULT 0.0,
                    text TEXT DEFAULT NULL,
                    label TEXT DEFAULT NULL,
                    label_updated_at TEXT DEFAULT NULL,
                    predicted_label TEXT DEFAULT NULL,
                    predicted_confidence REAL DEFAULT NULL,
                    PRIMARY KEY (frame_index, box_index)
                ) WITHOUT ROWID
                """
            )

            # Populate boxes table from fullOCR.db
            ocr_conn = sqlite3.connect(str(db_path))
            ocr_cursor = ocr_conn.execute(
                "SELECT frame_index, box_index, text, x, y, width, height FROM full_frame_ocr ORDER BY frame_index, box_index"
            )

            for row in ocr_cursor:
                frame_index, box_index, text, x, y, width, height = row
                # Transform coordinates: x,y,width,height → left,top,right,bottom
                bbox_left = x
                bbox_bottom = y
                bbox_right = x + width
                bbox_top = y + height

                layout_conn.execute(
                    """
                    INSERT INTO boxes (frame_index, box_index, bbox_left, bbox_top, bbox_right, bbox_bottom, text)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        frame_index,
                        box_index,
                        bbox_left,
                        bbox_top,
                        bbox_right,
                        bbox_bottom,
                        text,
                    ),
                )

            ocr_conn.close()

            # Create layout_config table
            # DEFAULT values required for CR-SQLite compatibility (v0.16.1+)
            # Schema must match client expectations in database-queries.ts
            layout_conn.execute(
                """
                CREATE TABLE layout_config (
                    id INTEGER NOT NULL PRIMARY KEY CHECK(id = 1),
                    frame_width INTEGER NOT NULL DEFAULT 0,
                    frame_height INTEGER NOT NULL DEFAULT 0,
                    crop_left REAL NOT NULL DEFAULT 0,
                    crop_top REAL NOT NULL DEFAULT 0,
                    crop_right REAL NOT NULL DEFAULT 1,
                    crop_bottom REAL NOT NULL DEFAULT 1,
                    selection_left REAL DEFAULT NULL,
                    selection_top REAL DEFAULT NULL,
                    selection_right REAL DEFAULT NULL,
                    selection_bottom REAL DEFAULT NULL,
                    vertical_center REAL DEFAULT NULL,
                    vertical_std REAL DEFAULT NULL,
                    box_height INTEGER DEFAULT NULL,
                    box_height_std REAL DEFAULT NULL,
                    anchor_type TEXT DEFAULT NULL,
                    anchor_position REAL DEFAULT NULL,
                    top_edge_std REAL DEFAULT NULL,
                    bottom_edge_std REAL DEFAULT NULL,
                    horizontal_std_slope REAL DEFAULT NULL,
                    horizontal_std_intercept REAL DEFAULT NULL,
                    crop_region_version INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )

            # Initialize layout_config with frame dimensions
            layout_conn.execute(
                """
                INSERT INTO layout_config (id, frame_width, frame_height, crop_left, crop_top, crop_right, crop_bottom)
                VALUES (1, ?, ?, 0, 0, 1, 1)
                """,
                (video_info["width"], video_info["height"]),
            )

            # Create preferences table
            layout_conn.execute(
                """
                CREATE TABLE preferences (
                    id INTEGER NOT NULL PRIMARY KEY CHECK(id = 1),
                    layout_approved INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            layout_conn.execute(
                "INSERT INTO preferences (id, layout_approved) VALUES (1, 0)"
            )

            layout_conn.commit()
        finally:
            layout_conn.close()

        print(f"  Created layout.db with {total_boxes} boxes\n")

        # Step 6: Compress and upload raw-ocr.db.gz to Wasabi (server-only)
        print("[6/7] Compressing and uploading raw-ocr.db.gz to Wasabi (server)...")
        ocr_upload_start = time.time()

        # Compress the database
        import gzip

        ocr_db_gz_path = tmp_path / "raw-ocr.db.gz"
        with open(db_path, "rb") as f_in:
            with gzip.open(ocr_db_gz_path, "wb") as f_out:
                f_out.writelines(f_in)

        ocr_original_size = db_path.stat().st_size
        ocr_compressed_size = ocr_db_gz_path.stat().st_size
        ocr_ratio = (1 - ocr_compressed_size / ocr_original_size) * 100
        print(
            f"  Compressed {ocr_original_size:,} -> {ocr_compressed_size:,} bytes ({ocr_ratio:.1f}% reduction)"
        )

        ocr_db_storage_key = f"{tenant_id}/server/videos/{video_id}/raw-ocr.db.gz"
        wasabi_client.upload_file(
            str(ocr_db_gz_path),
            bucket_name,
            ocr_db_storage_key,
            ExtraArgs={"ContentType": "application/gzip"},
        )

        print(f"  Uploaded in {time.time() - ocr_upload_start:.2f}s\n")

        # Step 7: Compress and upload layout.db.gz to Wasabi (client-facing)
        print("[7/7] Compressing and uploading layout.db.gz to Wasabi (client)...")
        layout_upload_start = time.time()

        # Compress the database
        import gzip

        layout_db_gz_path = tmp_path / "layout.db.gz"
        with open(layout_db_path, "rb") as f_in:
            with gzip.open(layout_db_gz_path, "wb") as f_out:
                f_out.writelines(f_in)

        original_size = layout_db_path.stat().st_size
        compressed_size = layout_db_gz_path.stat().st_size
        ratio = (1 - compressed_size / original_size) * 100
        print(
            f"  Compressed {original_size:,} -> {compressed_size:,} bytes ({ratio:.1f}% reduction)"
        )

        layout_db_storage_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        wasabi_client.upload_file(
            str(layout_db_gz_path),
            bucket_name,
            layout_db_storage_key,
            ExtraArgs={"ContentType": "application/gzip"},
        )

        print(f"  Uploaded in {time.time() - layout_upload_start:.2f}s\n")

        # Wait for background frame upload to complete
        print("Waiting for background frame upload to complete...")
        upload_thread.join()

        if upload_error:
            raise RuntimeError(f"Frame upload failed: {upload_error}")

        print("Background frame upload complete!\n")

        # Build output paths
        full_frames_prefix = f"{tenant_id}/client/videos/{video_id}/full_frames/"

        # Compute final metrics
        total_duration = time.time() - job_start

        print(f"{'=' * 80}")
        print("Job Complete")
        print(f"{'=' * 80}")
        print(f"Frames: {frame_count}")
        print(f"OCR boxes: {total_boxes}")
        print(f"Total duration: {total_duration:.2f}s")
        print(f"Server database (raw-ocr.db): {ocr_db_storage_key}")
        print(f"Client database (layout.db.gz): {layout_db_storage_key}")
        print(f"Frames prefix: {full_frames_prefix}")
        print(f"{'=' * 80}\n")

        return {
            "version": 1,
            "frame_count": frame_count,
            "duration": video_info["duration"],
            "frame_width": video_info["width"],
            "frame_height": video_info["height"],
            "video_codec": video_info["codec"],
            "bitrate": video_info["bitrate"],
            "ocr_box_count": total_boxes,
            "failed_ocr_count": failed_ocr_count,
            "processing_duration_seconds": total_duration,
            "full_frames_key": full_frames_prefix,
            "ocr_db_key": ocr_db_storage_key,
            "layout_db_key": layout_db_storage_key,
        }
