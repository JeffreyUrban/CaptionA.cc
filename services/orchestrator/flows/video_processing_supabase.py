"""
Video Processing Flow with Supabase Integration

Example of how to integrate Supabase status updates with Prefect flows.
This flow demonstrates:
1. Updating video status in Supabase
2. Storing metadata in multi-tenant catalog
3. Maintaining backward compatibility with SQLite database

To migrate existing flows, add similar status updates at key points.
"""

import os
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

import requests
from prefect import flow, task
from prefect.artifacts import create_table_artifact

# Import our Supabase client
from ..supabase_client import SearchIndexRepository, VideoRepository


@task(
    name="update-supabase-status",
    tags=["supabase", "status"],
    log_prints=True,
)
def update_supabase_status(
    video_id: str, status: str, prefect_flow_run_id: str | None = None
) -> None:
    """
    Update video status in Supabase.

    Args:
        video_id: Video UUID
        status: One of: uploading, processing, active, failed, archived
        prefect_flow_run_id: Current Prefect flow run ID
    """
    try:
        video_repo = VideoRepository()
        video_repo.update_video_status(
            video_id=video_id, status=status, prefect_flow_run_id=prefect_flow_run_id
        )
        print(f"✓ Supabase: Updated video {video_id} status to {status}")
    except Exception as e:
        # Don't fail the flow if Supabase update fails
        print(f"⚠ Warning: Failed to update Supabase status: {e}")


@task(
    name="update-annotations-db-key",
    tags=["supabase", "storage"],
    log_prints=True,
)
def update_annotations_db_key(video_id: str, annotations_db_key: str) -> None:
    """
    Update the Wasabi storage key for annotations database.

    Args:
        video_id: Video UUID
        annotations_db_key: Wasabi storage key (e.g., wasabi://videos/{tenant}/{video}/annotations.db)
    """
    try:
        video_repo = VideoRepository()
        video_repo.update_annotations_db_key(
            video_id=video_id, annotations_db_key=annotations_db_key
        )
        print(f"✓ Supabase: Updated annotations DB key for {video_id}")
    except Exception as e:
        print(f"⚠ Warning: Failed to update annotations DB key: {e}")


@task(
    name="index-video-content",
    tags=["supabase", "search"],
    log_prints=True,
)
def index_video_content(video_id: str, db_path: str) -> int:
    """
    Index OCR content in Supabase for cross-video search.

    Args:
        video_id: Video UUID
        db_path: Path to annotations.db with OCR results

    Returns:
        Number of frames indexed
    """
    try:
        search_repo = SearchIndexRepository()
        conn = sqlite3.connect(db_path)

        try:
            # Get OCR results from full_frame_ocr table
            cursor = conn.execute(
                """
                SELECT f.frame_index, GROUP_CONCAT(o.text, ' ') as ocr_text
                FROM full_frames f
                LEFT JOIN full_frame_ocr o ON f.id = o.frame_id
                GROUP BY f.frame_index
                ORDER BY f.frame_index
                """
            )

            indexed_count = 0
            for row in cursor:
                frame_index, ocr_text = row
                if ocr_text:  # Only index frames with OCR text
                    search_repo.upsert_frame_text(
                        video_id=video_id, frame_index=frame_index, ocr_text=ocr_text
                    )
                    indexed_count += 1

            print(f"✓ Supabase: Indexed {indexed_count} frames for video {video_id}")
            return indexed_count

        finally:
            conn.close()

    except Exception as e:
        print(f"⚠ Warning: Failed to index video content: {e}")
        return 0


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

    Args:
        video_path: Full path to video file
        db_path: Path to annotations.db
        output_dir: Directory to write frames
        frame_rate: Frame extraction rate in Hz (default 0.1 = every 10 seconds)

    Returns:
        Dict with db_path and processing results
    """
    print(f"Extracting frames from {video_path} at {frame_rate}Hz")

    video_path_abs = str(Path(video_path).resolve())
    output_dir_abs = str(Path(output_dir).resolve())
    Path(output_dir_abs).mkdir(parents=True, exist_ok=True)

    pipeline_dir = Path(__file__).parent.parent.parent.parent / "data-pipelines" / "full_frames"

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
        print(f"STDERR: {result.stderr}")
        raise RuntimeError(f"full_frames pipeline failed: {result.stderr}")

    # Get frame count from database
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
    }


@flow(
    name="process-video-with-supabase",
    log_prints=True,
    retries=1,
    retry_delay_seconds=120,
)
def process_video_with_supabase_flow(
    video_id: str,
    video_path: str,
    db_path: str,
    output_dir: str,
    frame_rate: float = 0.1,
) -> dict[str, Any]:
    """
    Initial video processing with Supabase integration.

    This flow demonstrates how to:
    1. Update Supabase status throughout processing
    2. Index content for cross-video search
    3. Maintain backward compatibility with SQLite

    Args:
        video_id: Video UUID (matches Supabase videos.id)
        video_path: Full path to video file
        db_path: Path to annotations.db
        output_dir: Directory for frame output
        frame_rate: Frame extraction rate in Hz

    Returns:
        Dict with video_id, status, and metrics
    """
    from prefect.runtime import flow_run

    flow_run_id = flow_run.id

    print(f"🎬 Starting processing for video: {video_id}")
    print(f"📁 Video path: {video_path}")
    print(f"🗄️  Database: {db_path}")

    # Check if video/database exists
    if not Path(video_path).exists() or not Path(db_path).exists():
        print(f"⚠️  Video or database not found: {video_id}")
        # Update Supabase to mark as failed
        update_supabase_status(video_id, "failed", flow_run_id)
        return {"video_id": video_id, "status": "cancelled", "message": "Video not found"}

    # Update Supabase: Start processing
    update_supabase_status(video_id, "processing", flow_run_id)

    # Update local SQLite database
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            UPDATE processing_status
            SET status = 'extracting_frames',
                processing_started_at = datetime('now')
            WHERE id = 1
            """
        )
        conn.commit()
    finally:
        conn.close()

    # Send webhook notification at START
    try:
        webhook_url = os.getenv("WEB_APP_URL", "http://localhost:5173")
        requests.post(
            f"{webhook_url}/api/webhooks/prefect",
            json={
                "videoId": video_id,
                "flowName": "process-video-with-supabase",
                "status": "started",
            },
            timeout=5,
        )
    except Exception as e:
        print(f"⚠️  Failed to send start webhook: {e}")

    try:
        # Extract frames and run OCR
        frames_result = extract_full_frames(
            video_path=video_path,
            db_path=db_path,
            output_dir=output_dir,
            frame_rate=frame_rate,
        )

        # Index video content in Supabase for search
        indexed_frames = index_video_content(video_id, db_path)

        # Update local database status
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                UPDATE processing_status
                SET status = 'processing_complete',
                    processing_completed_at = datetime('now')
                WHERE id = 1
                """
            )
            conn.commit()
        finally:
            conn.close()

        # Update Supabase: Mark as active
        update_supabase_status(video_id, "active", flow_run_id)

        # Create Prefect artifacts for visibility
        create_table_artifact(
            key=f"video-{video_id}-processing",
            table={
                "Video ID": [video_id],
                "Frames Extracted": [frames_result["frame_count"]],
                "OCR Boxes": [frames_result["ocr_count"]],
                "Indexed Frames": [indexed_frames],
                "Status": ["Active - Ready for Annotation"],
            },
            description=f"Processing complete for video {video_id}",
        )

        print(f"✅ Processing complete for {video_id}")
        print(f"📊 Frames: {frames_result['frame_count']}, OCR: {frames_result['ocr_count']}")
        print(f"🔍 Indexed: {indexed_frames} frames")

        # Send completion webhook
        try:
            webhook_url = os.getenv("WEB_APP_URL", "http://localhost:5173")
            requests.post(
                f"{webhook_url}/api/webhooks/prefect",
                json={
                    "videoId": video_id,
                    "flowName": "process-video-with-supabase",
                    "status": "complete",
                },
                timeout=5,
            )
        except Exception as e:
            print(f"⚠️  Failed to send completion webhook: {e}")

        return {
            "video_id": video_id,
            "status": "completed",
            "frame_count": frames_result["frame_count"],
            "ocr_count": frames_result["ocr_count"],
            "indexed_frames": indexed_frames,
        }

    except Exception as e:
        print(f"❌ Processing failed for {video_id}: {e}")

        # Update Supabase: Mark as failed
        update_supabase_status(video_id, "failed", flow_run_id)

        # Update local database
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("UPDATE processing_status SET status = 'processing_failed' WHERE id = 1")
            conn.commit()
        finally:
            conn.close()

        # Send failure webhook
        try:
            webhook_url = os.getenv("WEB_APP_URL", "http://localhost:5173")
            requests.post(
                f"{webhook_url}/api/webhooks/prefect",
                json={
                    "videoId": video_id,
                    "flowName": "process-video-with-supabase",
                    "status": "error",
                    "error": str(e),
                },
                timeout=5,
            )
        except Exception as webhook_error:
            print(f"⚠️  Failed to send failure webhook: {webhook_error}")

        raise
