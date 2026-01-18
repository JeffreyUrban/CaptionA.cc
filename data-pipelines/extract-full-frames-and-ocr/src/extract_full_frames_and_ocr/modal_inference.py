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

    from extract_full_frames_and_ocr.pipeline import process_video_with_gpu_and_ocr

    # Get S3 client (following captionacc-modal pattern)
    wasabi_client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{os.getenv('WASABI_REGION')}.wasabisys.com",
        aws_access_key_id=os.getenv("WASABI_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("WASABI_SECRET_KEY"),
        region_name=os.getenv("WASABI_REGION"),
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
        print("[1/4] Downloading video from Wasabi...")
        download_start = time.time()
        video_path = tmp_path / "video.mp4"
        wasabi_client.download_file(bucket_name, video_key, str(video_path))
        print(f"  Downloaded in {time.time() - download_start:.2f}s\n")

        # Step 2: Process video with GPU + Google Vision OCR
        print("[2/4] Processing video with GPU + Google Vision OCR...")
        db_path = tmp_path / "fullOCR.db"

        total_boxes, failed_ocr_count, video_info = process_video_with_gpu_and_ocr(
            video_path=video_path,
            db_path=db_path,
            rate_hz=rate_hz,
            language=language,
        )

        # Step 3: Count frames and get stats
        print("[3/4] Collecting statistics...")
        import sqlite3

        conn = sqlite3.connect(str(db_path))

        # Count frames
        cursor = conn.execute("SELECT COUNT(DISTINCT frame_index) FROM full_frame_ocr")
        frame_count = cursor.fetchone()[0]

        # Verify total boxes
        cursor = conn.execute("SELECT COUNT(*) FROM full_frame_ocr")
        db_box_count = cursor.fetchone()[0]

        conn.close()

        print(f"  Frame count: {frame_count}")
        print(f"  Total OCR boxes: {total_boxes}")
        print(f"  DB box count: {db_box_count}")
        print(f"  Boxes match: {total_boxes == db_box_count}\n")

        # Step 4: Create layout.db with boxes table (client-facing)
        print("[4/6] Creating layout.db for client...")
        layout_db_path = tmp_path / "layout.db"

        import sqlite3

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
            layout_conn.execute(
                """
                CREATE TABLE boxes (
                    frame_index INTEGER NOT NULL,
                    box_index INTEGER NOT NULL,
                    bbox_left REAL NOT NULL,
                    bbox_top REAL NOT NULL,
                    bbox_right REAL NOT NULL,
                    bbox_bottom REAL NOT NULL,
                    text TEXT,
                    label TEXT,
                    label_updated_at TEXT,
                    predicted_label TEXT,
                    predicted_confidence REAL,
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
                    (frame_index, box_index, bbox_left, bbox_top, bbox_right, bbox_bottom, text),
                )

            ocr_conn.close()

            # Create layout_config table
            layout_conn.execute(
                """
                CREATE TABLE layout_config (
                    id INTEGER NOT NULL PRIMARY KEY CHECK(id = 1),
                    frame_width INTEGER NOT NULL,
                    frame_height INTEGER NOT NULL,
                    crop_left REAL NOT NULL DEFAULT 0,
                    crop_top REAL NOT NULL DEFAULT 0,
                    crop_right REAL NOT NULL DEFAULT 1,
                    crop_bottom REAL NOT NULL DEFAULT 1,
                    anchor_type TEXT,
                    anchor_position REAL,
                    vertical_center REAL,
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
            layout_conn.execute("INSERT INTO preferences (id, layout_approved) VALUES (1, 0)")

            layout_conn.commit()
        finally:
            layout_conn.close()

        print(f"  Created layout.db with {total_boxes} boxes\n")

        # Step 5: Compress and upload raw-ocr.db.gz to Wasabi (server-only)
        print("[5/6] Compressing and uploading raw-ocr.db.gz to Wasabi (server)...")
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
        print(f"  Compressed {ocr_original_size:,} -> {ocr_compressed_size:,} bytes ({ocr_ratio:.1f}% reduction)")

        ocr_db_storage_key = f"{tenant_id}/server/videos/{video_id}/raw-ocr.db.gz"
        wasabi_client.upload_file(
            str(ocr_db_gz_path),
            bucket_name,
            ocr_db_storage_key,
            ExtraArgs={"ContentType": "application/gzip"},
        )

        print(f"  Uploaded in {time.time() - ocr_upload_start:.2f}s\n")

        # Step 6: Compress and upload layout.db.gz to Wasabi (client-facing)
        print("[6/6] Compressing and uploading layout.db.gz to Wasabi (client)...")
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
        print(f"  Compressed {original_size:,} -> {compressed_size:,} bytes ({ratio:.1f}% reduction)")

        layout_db_storage_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        wasabi_client.upload_file(
            str(layout_db_gz_path),
            bucket_name,
            layout_db_storage_key,
            ExtraArgs={"ContentType": "application/gzip"},
        )

        print(f"  Uploaded in {time.time() - layout_upload_start:.2f}s\n")

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
