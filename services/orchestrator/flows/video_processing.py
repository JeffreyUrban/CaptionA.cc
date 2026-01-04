"""
Video Processing Flow

Handles initial video processing after upload:
1. Extract frames at 0.1Hz
2. Run OCR on frames
3. Initialize layout analysis

This replaces apps/captionacc-web/app/services/video-processing.ts
"""

from pathlib import Path
import sqlite3
import subprocess
from typing import Any

from prefect import flow, task
from prefect.artifacts import create_table_artifact, create_link_artifact


@task(
    name="extract-full-frames",
    retries=3,
    retry_delay_seconds=60,
    tags=["video-processing", "frames", "ocr"],
    log_prints=True,
)
def extract_full_frames(
    video_path: str, db_path: str, output_dir: str, frame_rate: float = 0.1
) -> dict[str, Any]:
    """
    Extract frames at specified rate using existing full_frames pipeline.

    Asset produced: full_frames table + full_frame_ocr table in SQLite

    Args:
        video_path: Full path to video file
        db_path: Path to annotations.db
        output_dir: Directory to write frames
        frame_rate: Frame extraction rate in Hz (default 0.1 = every 10 seconds)

    Returns:
        Dict with db_path and processing results
    """
    print(f"Extracting frames from {video_path} at {frame_rate}Hz")
    print(f"Output directory: {output_dir}")

    # Convert to absolute paths (pipeline runs from different cwd)
    video_path_abs = str(Path(video_path).resolve())
    output_dir_abs = str(Path(output_dir).resolve())

    # Ensure output directory exists
    Path(output_dir_abs).mkdir(parents=True, exist_ok=True)

    # Get absolute path to full_frames pipeline
    pipeline_dir = Path(__file__).parent.parent.parent.parent / "data-pipelines" / "full_frames"

    print(f"Absolute video path: {video_path_abs}")
    print(f"Absolute output dir: {output_dir_abs}")

    # Call existing pipeline
    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "full_frames",
            "analyze",
            video_path_abs,
            "--output-dir",
            output_dir_abs,
            "--frame-rate",
            str(frame_rate),
        ],
        cwd=str(pipeline_dir),
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(f"full_frames pipeline failed with code {result.returncode}: {result.stderr}")

    print("Frame extraction completed successfully")
    print(f"Output: {result.stdout}")

    # Get OCR count from database
    conn = sqlite3.connect(db_path)
    try:
        ocr_count = conn.execute("SELECT COUNT(*) FROM full_frame_ocr").fetchone()[0]
        frame_count = conn.execute("SELECT COUNT(*) FROM full_frames").fetchone()[0]
    finally:
        conn.close()

    return {
        "db_path": db_path,
        "status": "completed",
        "frame_count": frame_count,
        "ocr_count": ocr_count,
        "output": result.stdout,
    }


@task(
    name="update-processing-status",
    tags=["database"],
    log_prints=True,
)
def update_processing_status(db_path: str, status: str) -> None:
    """
    Update processing_status table in database.

    Preserves existing database schema and status tracking.

    Args:
        db_path: Path to annotations.db
        status: New status value (e.g., 'processing_complete')
    """
    print(f"Updating status to: {status}")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            UPDATE processing_status
            SET status = ?,
                processing_completed_at = datetime('now'),
                frame_extraction_progress = 1.0,
                ocr_progress = 1.0,
                layout_analysis_progress = 1.0
            WHERE id = 1
        """,
            (status,),
        )
        conn.commit()
    finally:
        conn.close()

    print(f"Status updated successfully to: {status}")


@flow(
    name="process-video-initial",
    log_prints=True,
    retries=1,
    retry_delay_seconds=120,
)
def process_video_initial_flow(
    video_id: str,
    video_path: str,
    db_path: str,
    output_dir: str,
    frame_rate: float = 0.1,
) -> dict[str, Any]:
    """
    Initial background processing after video upload.

    This flow:
    1. Extracts frames at 0.1Hz (configurable)
    2. Runs OCR on all extracted frames
    3. Updates database status
    4. Creates artifacts for visibility

    Priority: Low (background job)

    Args:
        video_id: Video UUID
        video_path: Full path to video file
        db_path: Path to annotations.db
        output_dir: Directory for frame output
        frame_rate: Frame extraction rate in Hz

    Returns:
        Dict with video_id, status, and processing metrics
    """
    print(f"Starting initial processing for video: {video_id}")
    print(f"Video path: {video_path}")
    print(f"Database: {db_path}")

    # Extract frames and run OCR
    frames_result = extract_full_frames(
        video_path=video_path, db_path=db_path, output_dir=output_dir, frame_rate=frame_rate
    )

    # Update database status
    update_processing_status(db_path=db_path, status="processing_complete")

    # Create human-readable artifact for UI
    create_table_artifact(
        key=f"video-{video_id}-initial-processing",
        table={
            "Video ID": [video_id],
            "Frames Extracted": [frames_result["frame_count"]],
            "OCR Boxes": [frames_result["ocr_count"]],
            "Status": ["Ready for Layout Annotation"],
        },
        description=f"Initial processing complete for video {video_id}",
    )

    # Link to database for easy access
    create_link_artifact(
        key=f"video-{video_id}-database",
        link=f"file://{db_path}",
        description=f"SQLite database for video {video_id}",
    )

    print(f"Initial processing complete for {video_id}")
    print(f"Frames: {frames_result['frame_count']}, OCR boxes: {frames_result['ocr_count']}")

    return {
        "video_id": video_id,
        "status": "completed",
        "frame_count": frames_result["frame_count"],
        "ocr_count": frames_result["ocr_count"],
    }
