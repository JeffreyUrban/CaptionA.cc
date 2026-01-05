"""
Crop Frames Processing Flow

Handles frame cropping after layout annotation:
1. Extract frames at 10Hz with crop bounds
2. Write to cropped_frames table
3. Update crop_frames_status

This replaces apps/captionacc-web/app/services/crop-frames-processing.ts
"""

import os
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

import requests
from prefect import flow, task
from prefect.artifacts import create_table_artifact

# Import VP9 encoding flow for deferred encoding
from .vp9_encoding import encode_vp9_chunks_flow


@task(
    name="extract-cropped-frames",
    retries=3,
    retry_delay_seconds=60,
    tags=["crop-frames", "user-initiated"],
    log_prints=True,
)
def extract_cropped_frames(
    video_path: str,
    db_path: str,
    output_dir: str,
    crop_bounds: dict[str, int],
    crop_bounds_version: int = 1,
    frame_rate: float = 10.0,
) -> dict[str, Any]:
    """
    Extract cropped frames at 10Hz using existing crop_frames pipeline.

    Asset produced: cropped_frames table in SQLite
    Asset dependency: layout_config (crop bounds from user annotation)

    Args:
        video_path: Full path to video file
        db_path: Path to annotations.db
        output_dir: Directory to write cropped frames
        crop_bounds: Dict with keys: left, top, right, bottom
        crop_bounds_version: Version of crop bounds (from layout_config)
        frame_rate: Frame extraction rate in Hz (default 10.0)

    Returns:
        Dict with db_path and frame count
    """
    print(f"Extracting cropped frames from {video_path}")
    print(f"Crop bounds: {crop_bounds}")
    print(f"Frame rate: {frame_rate}Hz")

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Format crop bounds as string
    crop_str = (
        f"{crop_bounds['left']},{crop_bounds['top']},{crop_bounds['right']},{crop_bounds['bottom']}"
    )

    # Get absolute path to crop_frames pipeline
    pipeline_dir = Path(__file__).parent.parent.parent.parent / "data-pipelines" / "crop_frames"

    # Call existing pipeline
    result = subprocess.run(
        [
            "uv",
            "run",
            "crop_frames",
            "extract-frames",
            video_path,
            output_dir,
            "--crop",
            crop_str,
            "--rate",
            str(frame_rate),
            "--write-to-db",
            "--crop-bounds-version",
            str(crop_bounds_version),
        ],
        cwd=str(pipeline_dir),
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(
            f"crop_frames pipeline failed with code {result.returncode}: {result.stderr}"
        )

    print("Crop frames extraction completed successfully")
    print(f"Output: {result.stdout}")

    # Get frame count from database
    conn = sqlite3.connect(db_path)
    try:
        frame_count = conn.execute("SELECT COUNT(*) FROM cropped_frames").fetchone()[0]
    finally:
        conn.close()

    return {
        "db_path": db_path,
        "status": "completed",
        "frame_count": frame_count,
    }


@task(
    name="update-crop-status",
    tags=["database"],
    log_prints=True,
)
def update_crop_status(db_path: str, status: str) -> None:
    """
    Update crop_frames_status table in database.

    Args:
        db_path: Path to annotations.db
        status: New status value (e.g., 'complete')
    """
    print(f"Updating crop status to: {status}")

    conn = sqlite3.connect(db_path)
    try:
        # Ensure table exists
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crop_frames_status (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'queued',
                processing_started_at TEXT,
                processing_completed_at TEXT,
                current_job_id TEXT,
                error_message TEXT,
                error_details TEXT,
                error_occurred_at TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0
            )
        """
        )

        # Update status
        conn.execute(
            """
            INSERT OR REPLACE INTO crop_frames_status (id, status, processing_completed_at, retry_count)
            VALUES (1, ?, datetime('now'), 0)
        """,
            (status,),
        )
        conn.commit()
    finally:
        conn.close()

    print(f"Crop status updated to: {status}")


@flow(
    name="crop-video-frames",
    log_prints=True,
    retries=1,
    retry_delay_seconds=120,
)
def crop_frames_flow(
    video_id: str,
    video_path: str,
    db_path: str,
    output_dir: str,
    crop_bounds: dict[str, int],
    crop_bounds_version: int = 1,
    frame_rate: float = 10.0,
) -> dict[str, Any]:
    """
    User-initiated crop frames processing after layout approval.

    This flow:
    1. Extracts frames at 10Hz with crop bounds
    2. Writes to cropped_frames table
    3. Updates crop_frames_status

    Priority: High (user is waiting for this)

    Args:
        video_id: Video UUID
        video_path: Full path to video file
        db_path: Path to annotations.db
        output_dir: Directory for cropped frame output
        crop_bounds: Crop bounds from layout annotation (left, top, right, bottom)
        crop_bounds_version: Version from video_layout_config table
        frame_rate: Frame extraction rate in Hz

    Returns:
        Dict with video_id, status, and frame count
    """
    print(f"Starting crop frames processing for video: {video_id}")
    print(f"Crop bounds: {crop_bounds}")

    # Check if video/database still exists (may have been deleted)
    if not Path(video_path).exists() or not Path(db_path).exists():
        print(f"Video or database not found (may have been deleted): {video_id}")
        print("Exiting without retry")
        return {
            "video_id": video_id,
            "status": "cancelled",
            "message": "Video was deleted",
        }

    # Check if video is marked as deleted in database
    conn = sqlite3.connect(db_path)
    try:
        result = conn.execute("SELECT deleted FROM processing_status WHERE id = 1").fetchone()
        if result and result[0] == 1:
            print(f"Video marked as deleted in database: {video_id}")
            print("Exiting without retry")
            return {
                "video_id": video_id,
                "status": "cancelled",
                "message": "Video was deleted",
            }
    finally:
        conn.close()

    # Update database status to "processing" at START
    conn = sqlite3.connect(db_path)
    try:
        # Ensure table exists and update status
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS crop_frames_status (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'queued',
                processing_started_at TEXT,
                processing_completed_at TEXT,
                current_job_id TEXT,
                error_message TEXT,
                error_details TEXT,
                error_occurred_at TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO crop_frames_status (id, status, processing_started_at, retry_count)
            VALUES (1, 'processing', datetime('now'), 0)
            """
        )
        conn.commit()
    finally:
        conn.close()

    # Send webhook notification at START of processing
    try:
        webhook_url = os.getenv("WEB_APP_URL", "http://localhost:5173")
        webhook_endpoint = f"{webhook_url}/api/webhooks/prefect"
        webhook_payload = {
            "videoId": video_id,
            "flowName": "crop-video-frames",
            "status": "started",
        }
        print(f"Sending start webhook to {webhook_endpoint}")
        requests.post(webhook_endpoint, json=webhook_payload, timeout=5)
    except Exception as e:
        print(f"Warning: Failed to send start webhook: {e}")

    # Extract cropped frames
    result = extract_cropped_frames(
        video_path=video_path,
        db_path=db_path,
        output_dir=output_dir,
        crop_bounds=crop_bounds,
        crop_bounds_version=crop_bounds_version,
        frame_rate=frame_rate,
    )

    # Update status in database
    update_crop_status(db_path=db_path, status="complete")

    # Create artifact for visibility
    create_table_artifact(
        key=f"video-{video_id}-crop-frames",
        table={
            "Video ID": [video_id],
            "Cropped Frames": [result["frame_count"]],
            "Crop Bounds": [
                f"({crop_bounds['left']}, {crop_bounds['top']}, {crop_bounds['right']}, {crop_bounds['bottom']})"
            ],
            "Status": ["Ready for Boundary Annotation"],
        },
        description=f"Crop frames processing complete for {video_id}",
    )

    print(f"Crop frames complete for {video_id}: {result['frame_count']} frames")

    # Send webhook notification to web app
    try:
        webhook_url = os.getenv("WEB_APP_URL", "http://localhost:5173")
        webhook_endpoint = f"{webhook_url}/api/webhooks/prefect"

        webhook_payload = {
            "videoId": video_id,  # UUID (stable identifier)
            "flowName": "crop-video-frames",
            "status": "complete",
        }

        print(f"Sending webhook to {webhook_endpoint}")
        response = requests.post(
            webhook_endpoint,
            json=webhook_payload,
            timeout=5,
        )

        if response.ok:
            print(f"Webhook sent successfully: {response.status_code}")
        else:
            print(f"Webhook failed: {response.status_code} - {response.text}")

    except Exception as webhook_error:
        # Don't fail the flow if webhook fails
        print(f"Warning: Failed to send webhook notification: {webhook_error}")

    # Trigger VP9 encoding and Wasabi upload (deferred - runs after user notification)
    try:
        print("Starting VP9 encoding for cropped frames (background job)")
        encode_vp9_chunks_flow(
            video_id=video_id,
            db_path=db_path,
            frame_type="cropped",
            modulo_levels=[16, 4, 1],  # Hierarchical preview levels
        )
        print("VP9 encoding flow triggered successfully")
    except Exception as encoding_error:
        # Don't fail the crop_frames flow if VP9 encoding fails
        print(
            f"Warning: VP9 encoding failed (cropped frames still available in SQLite): {encoding_error}"
        )

    return {
        "video_id": video_id,
        "status": "completed",
        "frame_count": result["frame_count"],
    }
