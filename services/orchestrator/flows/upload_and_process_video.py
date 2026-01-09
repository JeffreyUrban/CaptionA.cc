"""
Upload and Process Video Flow - Wasabi + Split Database Architecture

This flow handles the complete video upload and initial processing pipeline:
1. Upload video file to Wasabi
2. Extract full frames (0.1Hz) → video.db
3. Upload video.db to Wasabi
4. Run OCR on full frames → fullOCR.db
5. Upload fullOCR.db to Wasabi
6. Create Supabase catalog entry
7. Index OCR content for search

Later workflows (user-initiated):
- Layout annotation → layout.db
- Crop frames processing → WebM chunks
- Caption annotation → captions.db
"""

import os
import subprocess
from pathlib import Path
from typing import Any

from prefect import flow, task
from prefect.artifacts import create_table_artifact

from supabase_client import SearchIndexRepository, VideoRepository
from wasabi_client import get_wasabi_client

# Default tenant for development (will be replaced with user's tenant in production)
DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"

@task(
    name="upload-video-to-wasabi",
    tags=["wasabi", "upload"],
    log_prints=True,
)
def upload_video_to_wasabi(
    local_video_path: str,
    tenant_id: str,
    video_id: str,
    filename: str,
) -> str:
    """Upload video file to Wasabi S3 storage."""
    print(f"[Wasabi] Uploading video: {filename}")

    client = get_wasabi_client()
    storage_key = client.build_storage_key(tenant_id, video_id, filename)

    client.upload_file(
        local_path=local_video_path,
        storage_key=storage_key,
        content_type="video/mp4",
    )

    print(f"[Wasabi] Video uploaded: {storage_key}")
    return storage_key

@task(
    name="upload-database-to-wasabi",
    tags=["wasabi", "upload"],
    log_prints=True,
)
def upload_database_to_wasabi(
    local_db_path: str,
    tenant_id: str,
    video_id: str,
    db_name: str,
) -> str:
    """
    Upload split database file to Wasabi.

    Args:
        local_db_path: Path to .db file on local disk
        tenant_id: Tenant UUID
        video_id: Video UUID
        db_name: Database filename (video.db, fullOCR.db, layout.db, captions.db)
    """
    print(f"[Wasabi] Uploading database: {db_name}")

    client = get_wasabi_client()
    storage_key = client.build_storage_key(tenant_id, video_id, db_name)

    client.upload_file(
        local_path=local_db_path,
        storage_key=storage_key,
        content_type="application/x-sqlite3",
    )

    print(f"[Wasabi] Database uploaded: {storage_key}")
    return storage_key

@task(
    name="create-supabase-video-entry",
    tags=["supabase", "database"],
    log_prints=True,
)
def create_supabase_video_entry(
    tenant_id: str,
    video_id: str,
    filename: str,
    video_storage_key: str,
    file_size: int,
    uploaded_by_user_id: str | None = None,
) -> dict[str, Any]:
    """Create video entry in Supabase catalog."""
    print(f"[Supabase] Creating video entry: {video_id}")

    video_repo = VideoRepository()

    video_record = {
        "id": video_id,
        "tenant_id": tenant_id,
        "filename": filename,
        "storage_key": video_storage_key,
        "size_bytes": file_size,
        "status": "processing",
        "uploaded_by_user_id": uploaded_by_user_id,
    }

    response = video_repo.client.table("videos").insert(video_record).execute()

    print(f"[Supabase] Video entry created: {video_id}")
    return response.data[0] if response.data else {}  # type: ignore[return-value]

@task(
    name="update-supabase-status",
    tags=["supabase", "status"],
    log_prints=True,
)
def update_supabase_status(
    video_id: str,
    status: str,
    prefect_flow_run_id: str | None = None,
) -> None:
    """Update video processing status in Supabase."""
    print(f"[Supabase] Updating status for {video_id}: {status}")

    video_repo = VideoRepository()
    video_repo.update_video_status(
        video_id=video_id,
        status=status,
        prefect_flow_run_id=prefect_flow_run_id,
    )

    print(f"[Supabase] Status updated: {status}")

@task(
    name="extract-full-frames-to-video-db",
    retries=3,
    retry_delay_seconds=60,
    tags=["video-processing", "frames"],
    log_prints=True,
)
def extract_full_frames_to_video_db(
    video_path: str,
    output_db_path: str,
    frame_rate: float = 0.1,
) -> dict[str, Any]:
    """
    Extract full frames at 0.1Hz and store in video.db.

    Creates video.db with:
    - full_frames table (JPEG BLOBs)
    - video_metadata table
    """
    print(f"[video.db] Extracting frames from {video_path} at {frame_rate}Hz")

    video_path_abs = str(Path(video_path).resolve())
    output_db_abs = str(Path(output_db_path).resolve())

    # Ensure parent directory exists
    Path(output_db_abs).parent.mkdir(parents=True, exist_ok=True)

    pipeline_dir = Path(__file__).parent.parent.parent.parent / "data-pipelines" / "full_frames"

    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "full_frames",
            "extract",
            video_path_abs,
            "--output-db",
            output_db_abs,
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

    print("[video.db] Frame extraction complete")

    # Get frame count from video.db
    import sqlite3

    conn = sqlite3.connect(output_db_abs)
    try:
        frame_count = conn.execute("SELECT COUNT(*) FROM full_frames").fetchone()[0]
    finally:
        conn.close()

    return {
        "db_path": output_db_abs,
        "frame_count": frame_count,
        "status": "completed",
    }

@task(
    name="run-ocr-to-fullOCR-db",
    retries=3,
    retry_delay_seconds=60,
    tags=["video-processing", "ocr"],
    log_prints=True,
)
def run_ocr_to_full_ocr_db(
    video_db_path: str,
    output_ocr_db_path: str,
) -> dict[str, Any]:
    """
    Run OCR on full frames from video.db and store results in fullOCR.db.

    Creates fullOCR.db with:
    - full_frame_ocr table (OCR detections, text, confidence, bounding boxes)
    """
    print(f"[fullOCR.db] Running OCR on frames from {video_db_path}")

    ocr_db_abs = str(Path(output_ocr_db_path).resolve())

    # Ensure parent directory exists
    Path(ocr_db_abs).parent.mkdir(parents=True, exist_ok=True)

    # TODO: Replace with actual OCR pipeline when available
    # For now, create empty fullOCR.db with schema
    import sqlite3

    conn = sqlite3.connect(ocr_db_abs)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS full_frame_ocr (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_id INTEGER NOT NULL,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                text TEXT,
                confidence REAL,
                bbox_left INTEGER,
                bbox_top INTEGER,
                bbox_right INTEGER,
                bbox_bottom INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_frame_index ON full_frame_ocr(frame_index)")
        conn.commit()

        ocr_count = conn.execute("SELECT COUNT(*) FROM full_frame_ocr").fetchone()[0]
    finally:
        conn.close()

    print(f"[fullOCR.db] OCR processing complete: {ocr_count} detections")

    return {
        "db_path": ocr_db_abs,
        "ocr_count": ocr_count,
        "status": "completed",
    }

@task(
    name="index-video-ocr-content",
    tags=["supabase", "search"],
    log_prints=True,
)
def index_video_ocr_content(video_id: str, full_ocr_db_path: str) -> int:
    """
    Index OCR content from fullOCR.db in Supabase for cross-video search.
    """
    try:
        import sqlite3

        search_repo = SearchIndexRepository()
        conn = sqlite3.connect(full_ocr_db_path)

        try:
            cursor = conn.execute(
                """
                SELECT frame_index, GROUP_CONCAT(text, ' ') as ocr_text
                FROM full_frame_ocr
                WHERE text IS NOT NULL AND text != ''
                GROUP BY frame_index
                ORDER BY frame_index
                """
            )

            indexed_count = 0
            for row in cursor:
                frame_index, ocr_text = row
                if ocr_text:
                    search_repo.upsert_frame_text(
                        video_id=video_id,
                        frame_index=frame_index,
                        ocr_text=ocr_text,
                    )
                    indexed_count += 1

            print(f"[Supabase] Indexed {indexed_count} frames for video {video_id}")
            return indexed_count

        finally:
            conn.close()

    except Exception as e:
        print(f"⚠️  Warning: Failed to index video content: {e}")
        return 0

@flow(
    name="upload-and-process-video",
    log_prints=True,
    retries=1,
    retry_delay_seconds=120,
)
def upload_and_process_video_flow(
    local_video_path: str,
    video_id: str,
    filename: str,
    file_size: int,
    tenant_id: str = DEFAULT_TENANT_ID,
    frame_rate: float = 0.1,
    uploaded_by_user_id: str | None = None,
) -> dict[str, Any]:
    """
    Complete upload and processing workflow for new videos.

    This flow:
    1. Uploads video to Wasabi
    2. Extracts full frames → video.db → uploads to Wasabi
    3. Runs OCR → fullOCR.db → uploads to Wasabi
    4. Creates Supabase catalog entry
    5. Indexes OCR content for search

    Later workflows (user-initiated):
    - Layout annotation → layout.db
    - Crop frames → WebM chunks
    - Caption annotation → captions.db

    Args:
        local_video_path: Path to video file on local disk (from TUS upload)
        video_id: Pre-generated video UUID
        filename: Original filename
        file_size: File size in bytes
        tenant_id: Tenant UUID (defaults to demo tenant)
        frame_rate: Frame extraction rate in Hz (default 0.1 = every 10 seconds)
        uploaded_by_user_id: User UUID who uploaded

    Returns:
        Dict with video_id, status, and metrics
    """
    from prefect.runtime import flow_run

    flow_run_id = flow_run.id

    print(f"🎬 Starting upload and processing for video: {video_id}")
    print(f"📁 Local video path: {local_video_path}")
    print(f"🏢 Tenant ID: {tenant_id}")

    # Check if video file exists
    if not Path(local_video_path).exists():
        print(f"⚠️  Video file not found: {local_video_path}")
        return {
            "video_id": video_id,
            "status": "error",
            "message": "Video file not found",
        }

    # Prepare paths for split databases
    video_dir = Path(local_video_path).parent
    video_db_path = video_dir / "video.db"
    full_ocr_db_path = video_dir / "fullOCR.db"

    try:
        # Step 1: Upload video to Wasabi
        print("\n📤 Step 1/7: Uploading video to Wasabi...")
        video_storage_key = upload_video_to_wasabi(
            local_video_path=local_video_path,
            tenant_id=tenant_id,
            video_id=video_id,
            filename=filename,
        )

        # Step 2: Create Supabase catalog entry
        print("\n📝 Step 2/7: Creating Supabase catalog entry...")
        create_supabase_video_entry(
            tenant_id=tenant_id,
            video_id=video_id,
            filename=filename,
            video_storage_key=video_storage_key,
            file_size=file_size,
            uploaded_by_user_id=uploaded_by_user_id,
        )

        # Step 3: Update status to processing
        print("\n⚙️  Step 3/7: Updating status to processing...")
        update_supabase_status(video_id, "processing", flow_run_id)

        # Step 4: Extract full frames to video.db
        print("\n🖼️  Step 4/7: Extracting full frames to video.db...")
        frames_result = extract_full_frames_to_video_db(
            video_path=local_video_path,
            output_db_path=str(video_db_path),
            frame_rate=frame_rate,
        )

        # Step 5: Upload video.db to Wasabi
        print("\n📤 Step 5/7: Uploading video.db to Wasabi...")
        upload_database_to_wasabi(
            local_db_path=str(video_db_path),
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="video.db",
        )

        # Step 6: Run OCR and create fullOCR.db
        print("\n🔍 Step 6/7: Running OCR and creating fullOCR.db...")
        ocr_result = run_ocr_to_full_ocr_db(
            video_db_path=str(video_db_path),
            output_ocr_db_path=str(full_ocr_db_path),
        )

        # Step 7: Upload fullOCR.db to Wasabi
        print("\n📤 Step 7/7: Uploading fullOCR.db to Wasabi...")
        upload_database_to_wasabi(
            local_db_path=str(full_ocr_db_path),
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="fullOCR.db",
        )

        # Step 8: Index OCR content for search
        print("\n🔍 Step 8/7: Indexing OCR content for search...")
        indexed_frames = index_video_ocr_content(video_id, str(full_ocr_db_path))

        # Update status to active
        update_supabase_status(video_id, "active", flow_run_id)

        # Create Prefect artifact for visibility
        create_table_artifact(
            key=f"video-{video_id}-upload-processing",
            table={
                "Video ID": [video_id],
                "Filename": [filename],
                "Storage Key": [video_storage_key],
                "Full Frames": [frames_result["frame_count"]],
                "OCR Detections": [ocr_result["ocr_count"]],
                "Indexed Frames": [indexed_frames],
                "Status": ["Active - Ready for Layout Annotation"],
            },
            description=f"Upload and processing complete for {filename}",
        )

        print(f"\n✅ Upload and processing complete for {video_id}")
        print(f"📊 Frames: {frames_result['frame_count']}, OCR: {ocr_result['ocr_count']}")
        print(f"🔍 Indexed: {indexed_frames} frames")

        return {
            "video_id": video_id,
            "status": "active",
            "frame_count": frames_result["frame_count"],
            "ocr_count": ocr_result["ocr_count"],
            "indexed_frames": indexed_frames,
        }

    except Exception as e:
        print(f"\n❌ Upload and processing failed: {e}")
        # Update Supabase status to failed
        try:
            update_supabase_status(video_id, "failed", flow_run_id)
        except Exception:
            pass
        raise
