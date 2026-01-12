"""
Frame extraction and OCR processing for Modal.

This module implements the extract_frames_and_ocr Modal function which:
1. Downloads video from Wasabi S3
2. Extracts frames at low frequency (0.1Hz default)
3. Runs Google Vision OCR on each frame
4. Creates and uploads OCR databases (raw-ocr.db.gz, layout.db.gz)
5. Uploads extracted frames to Wasabi S3

Reuses existing code from:
- video_utils: Frame extraction
- ocr_utils: OCR processing
- frames_db: Database storage
"""

import gzip
import os
import sqlite3
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import boto3
import ffmpeg
from botocore.exceptions import ClientError

from .models import ExtractResult


def get_s3_client():
    """Get configured S3 client for Wasabi.

    Returns:
        Configured boto3 S3 client

    Raises:
        ValueError: If required environment variables are missing
    """
    required_vars = ["WASABI_REGION", "WASABI_ACCESS_KEY", "WASABI_SECRET_KEY"]
    missing = [var for var in required_vars if not os.getenv(var)]

    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

    return boto3.client(
        "s3",
        endpoint_url=f"https://s3.{os.getenv('WASABI_REGION')}.wasabisys.com",
        aws_access_key_id=os.getenv("WASABI_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("WASABI_SECRET_KEY"),
        region_name=os.getenv("WASABI_REGION"),
    )


def get_video_metadata(video_path: Path) -> dict:
    """Get video metadata using ffprobe.

    Args:
        video_path: Path to video file

    Returns:
        Dict with duration, width, height, codec, and bitrate

    Raises:
        RuntimeError: If ffprobe fails
    """
    try:
        probe = ffmpeg.probe(str(video_path))

        # Get video stream
        video_stream = next(
            (stream for stream in probe["streams"] if stream["codec_type"] == "video"),
            None,
        )
        if not video_stream:
            raise RuntimeError("No video stream found")

        # Extract metadata
        duration = float(probe["format"]["duration"])
        width = int(video_stream["width"])
        height = int(video_stream["height"])
        codec = video_stream.get("codec_name", "unknown")

        # Bitrate can be in format or stream
        bitrate_str = probe["format"].get("bit_rate") or video_stream.get("bit_rate")
        bitrate = int(bitrate_str) if bitrate_str else 0

        return {
            "duration": duration,
            "width": width,
            "height": height,
            "codec": codec,
            "bitrate": bitrate,
        }
    except (ffmpeg.Error, KeyError, ValueError, StopIteration) as e:
        raise RuntimeError(f"Failed to get video metadata: {e}") from e


def extract_frames_ffmpeg(
    video_path: Path,
    output_dir: Path,
    rate_hz: float = 0.1,
) -> list[Path]:
    """Extract frames from video using FFmpeg.

    Args:
        video_path: Path to input video file
        output_dir: Directory to save extracted frames
        rate_hz: Frame sampling rate in Hz (default: 0.1)

    Returns:
        List of paths to extracted frame files

    Raises:
        RuntimeError: If FFmpeg fails
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    output_pattern = output_dir / "frame_%010d.jpg"

    try:
        stream = ffmpeg.input(str(video_path))
        stream = stream.filter("fps", fps=rate_hz)

        (
            stream.output(
                str(output_pattern),
                format="image2",
                **{"q:v": 6},  # JPEG quality
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode() if e.stderr else ""
        raise RuntimeError(f"FFmpeg failed: {stderr}") from e

    # Collect extracted frame paths
    frame_files = sorted(output_dir.glob("frame_*.jpg"))
    return frame_files


def process_frame_ocr_google_vision(image_path: Path) -> dict:
    """Run Google Vision OCR on a single frame.

    Args:
        image_path: Path to image file

    Returns:
        Dictionary with OCR results in format:
        {
            "image_path": str,
            "annotations": [[text, confidence, [x, y, width, height]], ...],
            "error": str (optional)
        }
    """
    from google.cloud import vision

    try:
        # Initialize Google Vision client
        client = vision.ImageAnnotatorClient()

        # Read image
        with open(image_path, "rb") as f:
            content = f.read()

        image = vision.Image(content=content)

        # Perform text detection
        response = client.text_detection(image=image)

        if response.error.message:
            raise RuntimeError(f"Google Vision API error: {response.error.message}")

        # Extract text annotations
        annotations = []
        for text_annotation in response.text_annotations[1:]:  # Skip first (full text)
            text = text_annotation.description
            confidence = 1.0  # Google Vision doesn't provide per-word confidence

            # Get bounding box (normalized to 0-1)
            vertices = text_annotation.bounding_poly.vertices

            # Calculate bounding box from vertices
            xs = [v.x for v in vertices]
            ys = [v.y for v in vertices]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)

            # We'll normalize later when we know image dimensions
            annotations.append([text, confidence, [x_min, y_min, x_max - x_min, y_max - y_min]])

        return {
            "image_path": str(image_path.relative_to(image_path.parent.parent)),
            "annotations": annotations,
        }

    except Exception as e:
        print(f"OCR error on {image_path.name}: {e}")
        return {
            "image_path": str(image_path.relative_to(image_path.parent.parent)),
            "annotations": [],
            "error": str(e),
        }


def create_raw_ocr_database(
    frames_dir: Path,
    ocr_results: list[dict],
    output_path: Path,
    frame_width: int,
    frame_height: int,
) -> int:
    """Create raw-ocr.db.gz with full OCR results.

    Args:
        frames_dir: Directory containing frame images
        ocr_results: List of OCR result dictionaries
        output_path: Output path for raw-ocr.db.gz
        frame_width: Frame width in pixels (for normalization)
        frame_height: Frame height in pixels (for normalization)

    Returns:
        Total number of OCR boxes inserted
    """
    # Create temporary database
    temp_db = output_path.with_suffix("")  # Remove .gz

    conn = sqlite3.connect(str(temp_db))
    try:
        # Create schema
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS database_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                migrated_at TEXT
            );
            INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1);

            CREATE TABLE IF NOT EXISTS full_frame_ocr (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                confidence REAL NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(frame_index, box_index)
            );
            CREATE INDEX IF NOT EXISTS idx_frame_index ON full_frame_ocr(frame_index);
        """)

        # Insert OCR results
        total_boxes = 0
        cursor = conn.cursor()

        for ocr_result in ocr_results:
            # Extract frame index from path
            image_path = Path(ocr_result["image_path"])
            frame_name = image_path.name
            frame_index = int(frame_name.split("_")[1].split(".")[0])

            annotations = ocr_result.get("annotations", [])

            for box_index, annotation in enumerate(annotations):
                text, confidence, bbox = annotation
                x_px, y_px, width_px, height_px = bbox

                # Normalize to 0-1 range
                x = x_px / frame_width
                y = y_px / frame_height
                width = width_px / frame_width
                height = height_px / frame_height

                cursor.execute(
                    """
                    INSERT INTO full_frame_ocr
                    (frame_index, box_index, text, confidence, x, y, width, height)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(frame_index, box_index) DO NOTHING
                    """,
                    (frame_index, box_index, text, confidence, x, y, width, height),
                )

                if cursor.rowcount > 0:
                    total_boxes += 1

        conn.commit()

    finally:
        conn.close()

    # Compress database
    with open(temp_db, "rb") as f_in:
        with gzip.open(output_path, "wb") as f_out:
            f_out.writelines(f_in)

    # Remove uncompressed database
    temp_db.unlink()

    return total_boxes


def create_layout_database(
    output_path: Path,
    frame_width: int,
    frame_height: int,
) -> None:
    """Create layout.db.gz with initial configuration.

    Args:
        output_path: Output path for layout.db.gz
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
    """
    # Create temporary database
    temp_db = output_path.with_suffix("")  # Remove .gz

    conn = sqlite3.connect(str(temp_db))
    try:
        # Create schema (matching API service schema)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS database_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                migrated_at TEXT
            );
            INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1);

            CREATE TABLE IF NOT EXISTS video_layout_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                frame_width INTEGER NOT NULL,
                frame_height INTEGER NOT NULL,
                crop_left INTEGER NOT NULL DEFAULT 0,
                crop_top INTEGER NOT NULL DEFAULT 0,
                crop_right INTEGER NOT NULL DEFAULT 0,
                crop_bottom INTEGER NOT NULL DEFAULT 0,
                selection_left INTEGER,
                selection_top INTEGER,
                selection_right INTEGER,
                selection_bottom INTEGER,
                selection_mode TEXT NOT NULL DEFAULT 'disabled',
                vertical_position REAL,
                vertical_std REAL,
                box_height REAL,
                box_height_std REAL,
                anchor_type TEXT,
                anchor_position REAL,
                top_edge_std REAL,
                bottom_edge_std REAL,
                horizontal_std_slope REAL,
                horizontal_std_intercept REAL,
                crop_region_version INTEGER NOT NULL DEFAULT 1,
                analysis_model_version TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS full_frame_box_labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                label TEXT NOT NULL CHECK (label IN ('in', 'out')),
                label_source TEXT NOT NULL DEFAULT 'user' CHECK (label_source IN ('user', 'model')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(frame_index, box_index, label_source)
            );
            CREATE INDEX IF NOT EXISTS idx_box_labels_frame ON full_frame_box_labels(frame_index);

            CREATE TABLE IF NOT EXISTS box_classification_model (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                model_data BLOB,
                model_version TEXT,
                trained_at TEXT
            );

            CREATE TABLE IF NOT EXISTS video_preferences (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                layout_approved INTEGER NOT NULL DEFAULT 0
            );
        """)

        # Insert initial layout config (no crop region, will be set by ML model)
        conn.execute(
            """
            INSERT OR REPLACE INTO video_layout_config (
                id, frame_width, frame_height,
                crop_left, crop_top, crop_right, crop_bottom,
                crop_region_version
            ) VALUES (1, ?, ?, 0, 0, ?, ?, 1)
            """,
            (frame_width, frame_height, frame_width, frame_height),
        )

        conn.commit()

    finally:
        conn.close()

    # Compress database
    with open(temp_db, "rb") as f_in:
        with gzip.open(output_path, "wb") as f_out:
            f_out.writelines(f_in)

    # Remove uncompressed database
    temp_db.unlink()


def upload_frames_to_wasabi(
    frames_dir: Path,
    tenant_id: str,
    video_id: str,
    bucket: str,
    s3_client,
) -> int:
    """Upload extracted frames to Wasabi S3.

    Args:
        frames_dir: Directory containing frame images
        tenant_id: Tenant UUID
        video_id: Video UUID
        bucket: S3 bucket name
        s3_client: Configured boto3 S3 client

    Returns:
        Number of frames uploaded
    """
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))

    for frame_file in frame_files:
        # Build S3 key: {tenant_id}/client/videos/{video_id}/full_frames/frame_{NNNNNN}.jpg
        s3_key = f"{tenant_id}/client/videos/{video_id}/full_frames/{frame_file.name}"

        # Upload frame
        s3_client.upload_file(
            str(frame_file),
            bucket,
            s3_key,
            ExtraArgs={"ContentType": "image/jpeg"}
        )

        print(f"Uploaded {frame_file.name}")

    return len(frame_files)


def upload_database_to_wasabi(
    db_path: Path,
    tenant_id: str,
    video_id: str,
    db_name: str,
    location: str,  # "server" or "client"
    bucket: str,
    s3_client,
) -> str:
    """Upload database to Wasabi S3.

    Args:
        db_path: Local path to database file (.db.gz)
        tenant_id: Tenant UUID
        video_id: Video UUID
        db_name: Database filename (e.g., "raw-ocr.db.gz")
        location: "server" or "client"
        bucket: S3 bucket name
        s3_client: Configured boto3 S3 client

    Returns:
        S3 key of uploaded database
    """
    # Build S3 key
    s3_key = f"{tenant_id}/{location}/videos/{video_id}/{db_name}"

    # Upload database
    s3_client.upload_file(
        str(db_path),
        bucket,
        s3_key,
        ExtraArgs={"ContentType": "application/gzip"}
    )

    print(f"Uploaded {db_name} to {s3_key}")

    return s3_key


def extract_frames_and_ocr_impl(
    video_key: str,
    tenant_id: str,
    video_id: str,
    frame_rate: float = 0.1,
) -> ExtractResult:
    """Implementation of extract_frames_and_ocr Modal function.

    Args:
        video_key: Wasabi S3 key for video file
        tenant_id: Tenant UUID for path scoping
        video_id: Video UUID
        frame_rate: Frames per second to extract (default: 0.1)

    Returns:
        ExtractResult with frame count, duration, OCR stats, and S3 paths

    Raises:
        ValueError: Invalid parameters
        RuntimeError: Processing error (FFmpeg, OCR, etc.)
    """
    start_time = time.time()

    # Validate parameters
    if not video_key:
        raise ValueError("video_key is required")
    if not tenant_id:
        raise ValueError("tenant_id is required")
    if not video_id:
        raise ValueError("video_id is required")
    if frame_rate <= 0:
        raise ValueError(f"frame_rate must be positive, got {frame_rate}")

    # Get S3 client and bucket
    s3_client = get_s3_client()
    bucket = os.getenv("WASABI_BUCKET")
    if not bucket:
        raise ValueError("WASABI_BUCKET environment variable not set")

    print(f"Starting extract_frames_and_ocr for video {video_id}")
    print(f"Video key: {video_key}")
    print(f"Frame rate: {frame_rate} Hz")

    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Download video from Wasabi
        print("Downloading video from Wasabi...")
        video_path = temp_path / "video.mp4"
        try:
            s3_client.download_file(bucket, video_key, str(video_path))
        except ClientError as e:
            raise RuntimeError(f"Failed to download video from Wasabi: {e}") from e

        print(f"Downloaded video: {video_path.stat().st_size / 1024 / 1024:.1f} MB")

        # Get video metadata
        print("Getting video metadata...")
        metadata = get_video_metadata(video_path)
        duration = metadata["duration"]
        frame_width = metadata["width"]
        frame_height = metadata["height"]
        video_codec = metadata["codec"]
        bitrate = metadata["bitrate"]

        print(f"Duration: {duration:.1f}s")
        print(f"Dimensions: {frame_width}x{frame_height}")
        print(f"Codec: {video_codec}")
        print(f"Bitrate: {bitrate}")

        # Extract frames
        print(f"Extracting frames at {frame_rate} Hz...")
        frames_dir = temp_path / "frames"
        frame_files = extract_frames_ffmpeg(video_path, frames_dir, frame_rate)
        frame_count = len(frame_files)

        print(f"Extracted {frame_count} frames")

        # Run OCR on frames
        print("Running Google Vision OCR on frames...")
        ocr_results = []
        failed_ocr_count = 0

        for i, frame_file in enumerate(frame_files, 1):
            print(f"Processing frame {i}/{frame_count}: {frame_file.name}")
            ocr_result = process_frame_ocr_google_vision(frame_file)

            if "error" in ocr_result:
                failed_ocr_count += 1

            ocr_results.append(ocr_result)

        # Count total OCR boxes
        ocr_box_count = sum(len(r.get("annotations", [])) for r in ocr_results)

        print(f"OCR complete: {ocr_box_count} boxes detected, {failed_ocr_count} failures")

        # Create raw-ocr.db.gz
        print("Creating raw-ocr.db.gz...")
        raw_ocr_db_path = temp_path / "raw-ocr.db.gz"
        total_boxes = create_raw_ocr_database(
            frames_dir,
            ocr_results,
            raw_ocr_db_path,
            frame_width,
            frame_height,
        )

        print(f"Created raw-ocr.db.gz with {total_boxes} boxes")

        # Create layout.db.gz
        print("Creating layout.db.gz...")
        layout_db_path = temp_path / "layout.db.gz"
        create_layout_database(layout_db_path, frame_width, frame_height)

        print("Created layout.db.gz")

        # Upload frames to Wasabi
        print("Uploading frames to Wasabi...")
        frames_uploaded = upload_frames_to_wasabi(
            frames_dir,
            tenant_id,
            video_id,
            bucket,
            s3_client,
        )

        print(f"Uploaded {frames_uploaded} frames")

        # Upload raw-ocr.db.gz to Wasabi (server-only)
        print("Uploading raw-ocr.db.gz to Wasabi...")
        ocr_db_key = upload_database_to_wasabi(
            raw_ocr_db_path,
            tenant_id,
            video_id,
            "raw-ocr.db.gz",
            "server",
            bucket,
            s3_client,
        )

        # Upload layout.db.gz to Wasabi (client-accessible)
        print("Uploading layout.db.gz to Wasabi...")
        layout_db_key = upload_database_to_wasabi(
            layout_db_path,
            tenant_id,
            video_id,
            "layout.db.gz",
            "client",
            bucket,
            s3_client,
        )

        # Calculate processing duration
        processing_duration = time.time() - start_time

        print(f"Processing complete in {processing_duration:.1f}s")

        # Build full_frames_key (directory prefix)
        full_frames_key = f"{tenant_id}/client/videos/{video_id}/full_frames/"

        # Return result
        return ExtractResult(
            frame_count=frame_count,
            duration=duration,
            frame_width=frame_width,
            frame_height=frame_height,
            video_codec=video_codec,
            bitrate=bitrate,
            ocr_box_count=ocr_box_count,
            failed_ocr_count=failed_ocr_count,
            processing_duration_seconds=processing_duration,
            full_frames_key=full_frames_key,
            ocr_db_key=ocr_db_key,
            layout_db_key=layout_db_key,
        )
