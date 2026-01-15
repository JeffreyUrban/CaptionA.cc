"""Modal function for GPU-accelerated full frame extraction and OCR processing.

This function:
1. Downloads video from Wasabi
2. Extracts frames at specified rate using GPU acceleration
3. Processes frames with OCR service (montage assembly + Google Vision API)
4. Creates fullOCR.db with text detection results
5. Uploads database to Wasabi
6. Returns statistics
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
        .apt_install("libgl1-mesa-glx", "libglib2.0-0")
        .pip_install(
            # GPU Video Processing
            "PyNvVideoCodec",
            "torch>=2.0.0",
            # Core dependencies
            "numpy>=1.24.0",
            "Pillow>=10.0.0",
            "opencv-python-headless",  # For frames_db
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
            - total_ocr_boxes: Total OCR text boxes detected
            - processing_duration_seconds: Total processing time
            - fullOCR_db_key: Wasabi S3 key for database
            - full_frames_prefix: Wasabi S3 prefix for frame images

    Raises:
        ValueError: Invalid parameters
        RuntimeError: Processing error

    Wasabi Outputs:
        - {tenant_id}/client/videos/{video_id}/full_frames/frame_NNNNNNNNNN.jpg
        - {tenant_id}/server/videos/{video_id}/fullOCR.db
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

        total_boxes = process_video_with_gpu_and_ocr(
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

        # Step 4: Upload database to Wasabi
        print("[4/4] Uploading database to Wasabi...")
        upload_start = time.time()

        db_storage_key = f"{tenant_id}/server/videos/{video_id}/fullOCR.db"
        wasabi_client.upload_file(
            str(db_path),
            bucket_name,
            db_storage_key,
            ExtraArgs={"ContentType": "application/x-sqlite3"},
        )

        print(f"  Uploaded in {time.time() - upload_start:.2f}s\n")

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
        print(f"Database: {db_storage_key}")
        print(f"Frames prefix: {full_frames_prefix}")
        print(f"{'=' * 80}\n")

        return {
            "version": 1,
            "frame_count": frame_count,
            "total_ocr_boxes": total_boxes,
            "processing_duration_seconds": total_duration,
            "fullOCR_db_key": db_storage_key,
            "full_frames_prefix": full_frames_prefix,
        }
