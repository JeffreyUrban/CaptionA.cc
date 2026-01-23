"""Local frame extractor for development without Modal/GPU.

This module provides a CPU-based alternative to the Modal extract_full_frames_and_ocr
function. It uses ffmpeg for frame extraction and creates mock OCR data for testing.

Used when CAPTIONACC_NAMESPACE=local to enable full pipeline testing without
requiring Modal deployment or GPU resources.
"""

import gzip
import logging
import os
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import boto3

logger = logging.getLogger(__name__)


def get_s3_client():
    """Get S3 client configured for local MinIO or Wasabi.

    Uses app.config.Settings to properly load environment variables
    from .env.local for local development.
    """
    from app.config import get_settings

    settings = get_settings()

    # Use endpoint from settings, defaulting to Wasabi
    endpoint_url = settings.wasabi_endpoint_url
    region = settings.wasabi_region

    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.wasabi_access_key_readwrite,
        aws_secret_access_key=settings.wasabi_secret_key_readwrite,
        region_name=region,
    )


def extract_video_metadata(video_path: Path) -> dict:
    """Extract video metadata using ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    import json
    data = json.loads(result.stdout)

    # Find video stream
    video_stream = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            video_stream = stream
            break

    if not video_stream:
        raise ValueError("No video stream found")

    # Extract metadata
    duration = float(data["format"].get("duration", 0))
    width = video_stream.get("width", 0)
    height = video_stream.get("height", 0)
    codec = video_stream.get("codec_name", "unknown")
    bitrate = int(data["format"].get("bit_rate", 0))

    # Calculate FPS
    fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
    fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0

    return {
        "duration": duration,
        "width": width,
        "height": height,
        "codec": codec,
        "bitrate": bitrate,
        "fps": fps,
    }


def extract_frames_ffmpeg(video_path: Path, output_dir: Path, rate_hz: float) -> list[bytes]:
    """Extract frames using ffmpeg at specified rate."""
    # ffmpeg fps filter: fps=1/10 means 1 frame every 10 seconds (0.1 Hz)
    fps_filter = f"fps={rate_hz}"

    output_pattern = output_dir / "frame_%06d.jpg"

    cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vf", fps_filter,
        "-q:v", "2",  # High quality JPEG
        str(output_pattern),
    ]

    subprocess.run(cmd, capture_output=True, check=True)

    # Read all generated frames
    frames = []
    frame_files = sorted(output_dir.glob("frame_*.jpg"))
    for frame_file in frame_files:
        with open(frame_file, "rb") as f:
            frames.append(f.read())

    return frames


def create_mock_ocr_boxes(frame_count: int) -> list[dict]:
    """Create mock OCR boxes for testing.

    Generates realistic-looking subtitle boxes in the lower third of the frame.
    """
    boxes = []
    box_index = 0

    for frame_idx in range(frame_count):
        # Create 1-2 boxes per frame in typical subtitle position
        num_boxes = 1 if frame_idx % 3 != 0 else 2

        for i in range(num_boxes):
            # Subtitle position: lower third, centered horizontally
            box_height_frac = 0.05  # 5% of frame height
            box_width_frac = 0.6 + (i * 0.1)  # 60-70% of frame width

            # Position from bottom (fractional coordinates)
            y_from_bottom = 0.1 + (i * 0.08)  # 10-18% from bottom
            x_center = 0.5  # Centered

            bbox_left = x_center - (box_width_frac / 2)
            bbox_right = x_center + (box_width_frac / 2)
            bbox_bottom = y_from_bottom
            bbox_top = y_from_bottom + box_height_frac

            # Frame index in layout.db: timestamp * 10
            # With rate_hz=0.1, frame N appears at N/0.1 = N*10 seconds
            # So frame_index = timestamp * 10 = N*10 * 10 / 10 = N * 10
            layout_frame_index = frame_idx * 100  # 0, 100, 200, ...

            boxes.append({
                "frame_index": layout_frame_index,
                "box_index": box_index,
                "bbox_left": bbox_left,
                "bbox_top": bbox_top,
                "bbox_right": bbox_right,
                "bbox_bottom": bbox_bottom,
                "text": f"[Mock subtitle {frame_idx + 1}]" if i == 0 else f"[Line {i + 1}]",
            })
            box_index += 1

    return boxes


def create_layout_db(db_path: Path, boxes: list[dict], frame_width: int, frame_height: int) -> None:
    """Create layout.db with boxes and layout_config tables."""
    conn = sqlite3.connect(str(db_path))

    try:
        # Create database_metadata table
        conn.execute("""
            CREATE TABLE database_metadata (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                schema_version INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute(
            "INSERT INTO database_metadata (id, schema_version, created_at) VALUES (1, 1, datetime('now'))"
        )

        # Create boxes table (CR-SQLite compatible with DEFAULT values)
        conn.execute("""
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
        """)

        # Insert boxes
        for box in boxes:
            conn.execute("""
                INSERT INTO boxes (frame_index, box_index, bbox_left, bbox_top, bbox_right, bbox_bottom, text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                box["frame_index"],
                box["box_index"],
                box["bbox_left"],
                box["bbox_top"],
                box["bbox_right"],
                box["bbox_bottom"],
                box["text"],
            ))

        # Create layout_config table
        conn.execute("""
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
        """)

        # Initialize layout_config with frame dimensions
        conn.execute("""
            INSERT INTO layout_config (id, frame_width, frame_height, crop_left, crop_top, crop_right, crop_bottom)
            VALUES (1, ?, ?, 0, 0, 1, 1)
        """, (frame_width, frame_height))

        # Create preferences table
        conn.execute("""
            CREATE TABLE preferences (
                id INTEGER NOT NULL PRIMARY KEY CHECK(id = 1),
                layout_approved INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("INSERT INTO preferences (id, layout_approved) VALUES (1, 0)")

        conn.commit()
    finally:
        conn.close()


def create_raw_ocr_db(db_path: Path, boxes: list[dict]) -> None:
    """Create raw-ocr.db with full_frame_ocr table (server-only format)."""
    conn = sqlite3.connect(str(db_path))

    try:
        # Create full_frame_ocr table (server format: x, y, width, height)
        conn.execute("""
            CREATE TABLE full_frame_ocr (
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                confidence REAL DEFAULT 1.0,
                PRIMARY KEY (frame_index, box_index)
            )
        """)

        # Convert boxes to raw-ocr format
        for box in boxes:
            # Convert from layout.db format (left, top, right, bottom) to raw-ocr format (x, y, width, height)
            # In layout.db: top/bottom are y from bottom (fractional)
            # In raw-ocr.db: x, y, width, height in fractional coords
            x = box["bbox_left"]
            width = box["bbox_right"] - box["bbox_left"]
            y = box["bbox_bottom"]  # y from bottom
            height = box["bbox_top"] - box["bbox_bottom"]

            conn.execute("""
                INSERT INTO full_frame_ocr (frame_index, box_index, text, x, y, width, height)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                box["frame_index"],
                box["box_index"],
                box["text"],
                x,
                y,
                width,
                height,
            ))

        conn.commit()
    finally:
        conn.close()


def extract_frames_and_ocr_local(
    video_key: str,
    tenant_id: str,
    video_id: str,
    rate_hz: float = 0.1,
) -> dict[str, Any]:
    """Local implementation of extract_full_frames_and_ocr.

    Uses ffmpeg for frame extraction and creates mock OCR data.
    This enables full pipeline testing without Modal or GPU.

    Args:
        video_key: S3 key for video file
        tenant_id: Tenant UUID
        video_id: Video UUID
        rate_hz: Frame extraction rate in Hz

    Returns:
        Same structure as Modal function for compatibility
    """
    job_start = time.time()

    from app.config import get_settings

    settings = get_settings()

    logger.info(f"[LOCAL] Starting frame extraction for {video_id}")
    logger.info(f"[LOCAL] Video key: {video_key}")
    logger.info(f"[LOCAL] Rate: {rate_hz} Hz")
    logger.info(f"[LOCAL] S3 endpoint: {settings.wasabi_endpoint_url}")

    s3_client = get_s3_client()
    bucket_name = settings.wasabi_bucket

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Step 1: Download video
        logger.info("[LOCAL] Downloading video...")
        video_path = tmp_path / "video.mp4"
        s3_client.download_file(bucket_name, video_key, str(video_path))

        # Step 2: Get video metadata
        logger.info("[LOCAL] Extracting metadata...")
        video_info = extract_video_metadata(video_path)
        logger.info(f"[LOCAL] Duration: {video_info['duration']:.1f}s, "
                    f"Dimensions: {video_info['width']}x{video_info['height']}")

        # Step 3: Extract frames
        logger.info("[LOCAL] Extracting frames with ffmpeg...")
        frames_dir = tmp_path / "frames"
        frames_dir.mkdir()
        jpeg_frames = extract_frames_ffmpeg(video_path, frames_dir, rate_hz)
        frame_count = len(jpeg_frames)
        logger.info(f"[LOCAL] Extracted {frame_count} frames")

        # Step 4: Upload frames to S3
        logger.info("[LOCAL] Uploading frames...")
        frames_prefix = f"{tenant_id}/client/videos/{video_id}/full_frames"
        thumbnails_prefix = f"{tenant_id}/client/videos/{video_id}/full_frames_thumbnails"

        from PIL import Image
        import io

        for frame_num, jpeg_bytes in enumerate(jpeg_frames):
            timestamp = frame_num / rate_hz
            frame_index = int(timestamp * 10)
            frame_filename = f"frame_{frame_index:06d}.jpg"

            # Upload full frame
            frame_key = f"{frames_prefix}/{frame_filename}"
            s3_client.put_object(
                Bucket=bucket_name,
                Key=frame_key,
                Body=jpeg_bytes,
                ContentType="image/jpeg",
            )

            # Generate and upload thumbnail (320px width)
            img = Image.open(io.BytesIO(jpeg_bytes))
            target_width = 320
            aspect_ratio = img.height / img.width
            target_height = int(target_width * aspect_ratio)
            thumbnail = img.resize((target_width, target_height), Image.Resampling.LANCZOS)

            thumbnail_buffer = io.BytesIO()
            thumbnail.save(thumbnail_buffer, format="JPEG", quality=85, optimize=True)
            thumbnail_bytes = thumbnail_buffer.getvalue()

            thumbnail_key = f"{thumbnails_prefix}/{frame_filename}"
            s3_client.put_object(
                Bucket=bucket_name,
                Key=thumbnail_key,
                Body=thumbnail_bytes,
                ContentType="image/jpeg",
            )

        logger.info(f"[LOCAL] Uploaded {frame_count} frames and thumbnails")

        # Step 5: Create mock OCR boxes
        logger.info("[LOCAL] Creating mock OCR data...")
        boxes = create_mock_ocr_boxes(frame_count)
        total_boxes = len(boxes)
        logger.info(f"[LOCAL] Created {total_boxes} mock OCR boxes")

        # Step 6: Create and upload raw-ocr.db.gz
        logger.info("[LOCAL] Creating raw-ocr.db...")
        raw_ocr_db_path = tmp_path / "raw-ocr.db"
        create_raw_ocr_db(raw_ocr_db_path, boxes)

        raw_ocr_gz_path = tmp_path / "raw-ocr.db.gz"
        with open(raw_ocr_db_path, "rb") as f_in:
            with gzip.open(raw_ocr_gz_path, "wb") as f_out:
                f_out.write(f_in.read())

        ocr_db_key = f"{tenant_id}/server/videos/{video_id}/raw-ocr.db.gz"
        s3_client.upload_file(str(raw_ocr_gz_path), bucket_name, ocr_db_key)

        # Step 7: Create and upload layout.db.gz
        logger.info("[LOCAL] Creating layout.db...")
        layout_db_path = tmp_path / "layout.db"
        create_layout_db(layout_db_path, boxes, video_info["width"], video_info["height"])

        layout_gz_path = tmp_path / "layout.db.gz"
        with open(layout_db_path, "rb") as f_in:
            with gzip.open(layout_gz_path, "wb") as f_out:
                f_out.write(f_in.read())

        layout_db_key = f"{tenant_id}/client/videos/{video_id}/layout.db.gz"
        s3_client.upload_file(str(layout_gz_path), bucket_name, layout_db_key)

        total_duration = time.time() - job_start

        logger.info(f"[LOCAL] Processing complete in {total_duration:.1f}s")
        logger.info(f"[LOCAL] Frames: {frame_count}, Boxes: {total_boxes}")

        return {
            "version": 1,
            "frame_count": frame_count,
            "duration": video_info["duration"],
            "frame_width": video_info["width"],
            "frame_height": video_info["height"],
            "video_codec": video_info["codec"],
            "bitrate": video_info["bitrate"],
            "ocr_box_count": total_boxes,
            "failed_ocr_count": 0,
            "processing_duration_seconds": total_duration,
            "full_frames_key": f"{frames_prefix}/",
            "ocr_db_key": ocr_db_key,
            "layout_db_key": layout_db_key,
        }
