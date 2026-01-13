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

import subprocess
from pathlib import Path
from typing import Any

from prefect import flow, task
from prefect.artifacts import create_table_artifact

from supabase_client import VideoRepository
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
    video_path: str,
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
        "video_path": video_path,
        "storage_key": video_storage_key,
        "size_bytes": file_size,
        "status": "processing",
        "uploaded_by_user_id": uploaded_by_user_id,
    }

    try:
        response = (
            video_repo.client.schema(video_repo.client._preferred_schema)  # type: ignore[attr-defined]
            .table("videos")
            .insert(video_record)
            .execute()
        )
        print(f"[Supabase] Video entry created: {video_id}")
    except Exception as e:
        if "duplicate key" in str(e) or "already exists" in str(e):
            print(f"[Supabase] Video entry already exists, updating: {video_id}")
            # Update existing entry
            response = (
                video_repo.client.schema(video_repo.client._preferred_schema)  # type: ignore[attr-defined]
                .table("videos")
                .update(
                    {
                        "video_path": video_path,
                        "storage_key": video_storage_key,
                        "size_bytes": file_size,
                        "status": "processing",
                    }
                )
                .eq("id", video_id)
                .execute()
            )
        else:
            raise

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

    # Delete existing database to ensure idempotency
    if Path(output_db_abs).exists():
        Path(output_db_abs).unlink()
        print("[video.db] Deleted existing database for clean extraction")

    pipeline_dir = Path(__file__).parent.parent.parent.parent / "data-pipelines" / "full_frames"
    frames_dir = Path(output_db_abs).parent / "frames_temp"

    # Clean up existing frames directory for idempotency
    import shutil

    if frames_dir.exists():
        shutil.rmtree(frames_dir)
        print("[video.db] Deleted existing frames temp directory")

    frames_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Extract frames to temporary directory using sample-frames CLI
    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            "-m",
            "full_frames",
            "sample-frames",
            video_path_abs,
            "--output-dir",
            str(frames_dir),
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
        raise RuntimeError(f"full_frames sample-frames failed: {result.stderr}")

    print("[video.db] Frame extraction to directory complete")

    # Step 2: Write frames to video.db using frames_db package
    import sqlite3

    from frames_db import write_frames_batch
    from PIL import Image

    # Create video.db with the proper schema
    conn = sqlite3.connect(output_db_abs)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS full_frames (
            frame_index INTEGER PRIMARY KEY,
            image_data BLOB NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            file_size INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS video_metadata (
            video_path TEXT PRIMARY KEY,
            duration_seconds REAL,
            video_hash TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS database_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            migrated_at TEXT
        )
    """)
    conn.execute("""
        INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1)
    """)
    conn.commit()
    conn.close()

    # Collect frame data
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    frames = []
    for frame_file in frame_files:
        frame_index = int(frame_file.stem.split("_")[1])
        image_data = frame_file.read_bytes()
        img = Image.open(frame_file)
        width, height = img.size
        frames.append((frame_index, image_data, width, height))

    # Write frames to video.db
    write_frames_batch(
        db_path=Path(output_db_abs),
        frames=frames,
        table="full_frames",
    )

    # Clean up temporary frames directory
    import shutil

    shutil.rmtree(frames_dir)

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
    tenant_id: str,
    video_id: str,
    video_db_path: str,
    output_ocr_db_path: str,
) -> dict[str, Any]:
    """
    Run OCR on full frames from video.db and store results in fullOCR.db.

    The OCR service will download video.db directly from Wasabi.

    Creates fullOCR.db with:
    - full_frame_ocr table (OCR detections, text, confidence, bounding boxes)
    """
    import sqlite3

    from ocr_client import get_ocr_client

    print(f"[fullOCR.db] Running OCR on frames from {video_db_path}")

    video_db_abs = str(Path(video_db_path).resolve())
    ocr_db_abs = str(Path(output_ocr_db_path).resolve())

    # Ensure parent directory exists
    Path(ocr_db_abs).parent.mkdir(parents=True, exist_ok=True)

    # Delete existing OCR database to ensure idempotency
    if Path(ocr_db_abs).exists():
        Path(ocr_db_abs).unlink()
        print("[fullOCR.db] Deleted existing OCR database for clean processing")

    # Create fullOCR.db with schema
    ocr_conn = sqlite3.connect(ocr_db_abs)
    try:
        ocr_conn.execute("""
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
        ocr_conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_frame_index ON full_frame_ocr(frame_index)"
        )
        ocr_conn.execute("""
            CREATE TABLE IF NOT EXISTS database_metadata (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                migrated_at TEXT
            )
        """)
        ocr_conn.execute("""
            INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1)
        """)
        ocr_conn.commit()
    except Exception as e:
        ocr_conn.close()
        raise RuntimeError(f"Failed to create fullOCR.db schema: {e}") from e

    # Read frame metadata from video.db (just indices and dimensions)
    video_conn = sqlite3.connect(video_db_abs)
    try:
        cursor = video_conn.execute("""
            SELECT frame_index, width, height
            FROM full_frames
            ORDER BY frame_index
        """)

        frame_metadata = cursor.fetchall()
        total_frames = len(frame_metadata)

        if total_frames == 0:
            print("[fullOCR.db] No frames found in video.db")
            ocr_conn.close()
            return {
                "db_path": ocr_db_abs,
                "ocr_count": 0,
                "status": "completed",
            }

        print(f"[fullOCR.db] Found {total_frames} frames to process")

        # Get frame dimensions and all frame indices
        _, width, height = frame_metadata[0]
        all_frame_indices = [frame_index for frame_index, _, _ in frame_metadata]
        print(f"[fullOCR.db] Frame dimensions: {width}×{height}")
        print("[fullOCR.db] Note: OCR service will download video.db directly from Wasabi")

        # Get OCR service client
        ocr_client = get_ocr_client()

        # Check capacity for this frame size
        capacity = ocr_client.get_capacity(width, height)
        max_batch_size = capacity["max_images"]
        print(
            f"[fullOCR.db] Max batch size: {max_batch_size} (limited by {capacity['limiting_factor']})"
        )

        # Calculate optimal batch size to divide frames evenly
        if total_frames <= max_batch_size:
            # All frames fit in one batch
            batch_size = total_frames
            num_batches = 1
        else:
            # Divide frames evenly across multiple batches
            import math

            num_batches = math.ceil(total_frames / max_batch_size)
            batch_size = math.ceil(total_frames / num_batches)

        print(
            f"[fullOCR.db] Processing {total_frames} frames in {num_batches} batches of ~{batch_size} frames each"
        )

        # Process frames in batches
        total_detections = 0
        failed_batches = 0
        successful_batches = 0

        for batch_start in range(0, total_frames, batch_size):
            batch_end = min(batch_start + batch_size, total_frames)
            batch_frame_indices = all_frame_indices[batch_start:batch_end]

            batch_num = batch_start // batch_size + 1
            print(
                f"[fullOCR.db] Processing batch {batch_num}/{num_batches} ({batch_end - batch_start} frames)"
            )

            # Submit to OCR service and wait for results
            # OCR service will download video.db and extract these frames
            try:
                result = ocr_client.process_batch(
                    tenant_id=tenant_id,
                    video_id=video_id,
                    frame_indices=batch_frame_indices,
                    timeout=600,
                )  # 10min timeout for large batches

                print(
                    f"[fullOCR.db] Batch processed: {result['total_characters']} characters in {result['processing_time_ms']:.0f}ms"
                )

                # Store OCR results in fullOCR.db
                for ocr_result in result["results"]:
                    frame_index = int(ocr_result["id"].replace("frame_", ""))

                    for box_idx, char in enumerate(ocr_result["characters"]):
                        bbox = char["bbox"]
                        ocr_conn.execute(
                            """
                            INSERT INTO full_frame_ocr (
                                frame_id, frame_index, box_index, text, confidence,
                                bbox_left, bbox_top, bbox_right, bbox_bottom
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                            (
                                frame_index,  # frame_id (same as frame_index for full frames)
                                frame_index,
                                box_idx,
                                char["text"],
                                1.0,  # Google Vision doesn't provide per-char confidence, use 1.0
                                bbox["x"],
                                bbox["y"],
                                bbox["x"] + bbox["width"],
                                bbox["y"] + bbox["height"],
                            ),
                        )

                ocr_conn.commit()
                total_detections += result["total_characters"]
                successful_batches += 1

            except Exception as e:
                print(f"[fullOCR.db] Warning: Batch {batch_start // batch_size + 1} failed: {e}")
                failed_batches += 1
                # Continue with next batch instead of failing entire job

    finally:
        video_conn.close()
        ocr_conn.close()

    print(
        f"[fullOCR.db] OCR processing complete: {total_detections} detections from {total_frames} frames"
    )
    print(
        f"[fullOCR.db] Batches: {successful_batches} succeeded, {failed_batches} failed out of {num_batches}"
    )

    # Determine status based on results
    if failed_batches == num_batches:
        # All batches failed - this is a critical error
        status = "failed"
        print(f"[fullOCR.db] ERROR: All {num_batches} OCR batches failed!")
    elif failed_batches > 0:
        # Some batches failed - partial success
        status = "partial"
        print(f"[fullOCR.db] WARNING: {failed_batches}/{num_batches} batches failed")
    else:
        status = "completed"

    return {
        "db_path": ocr_db_abs,
        "ocr_count": total_detections,
        "frames_processed": total_frames,
        "successful_batches": successful_batches,
        "failed_batches": failed_batches,
        "status": status,
    }


@task(
    name="create-layout-db",
    tags=["video-processing", "database"],
    log_prints=True,
)
def create_layout_db(output_path: str) -> dict[str, Any]:
    """
    Create layout.db with schema for layout annotation.

    Creates empty tables:
    - video_layout_config (populated when user saves layout)
    - full_frame_box_labels (populated during annotation)
    - box_classification_model (populated after training)

    Args:
        output_path: Path where layout.db will be created
    """
    import sqlite3

    print(f"[layout.db] Creating layout database at {output_path}")

    layout_db_path = Path(output_path).resolve()
    layout_db_path.parent.mkdir(parents=True, exist_ok=True)

    # Delete existing to ensure idempotency
    if layout_db_path.exists():
        layout_db_path.unlink()
        print("[layout.db] Deleted existing layout database for clean creation")

    conn = sqlite3.connect(str(layout_db_path))
    try:
        # Create video_layout_config table (append-only for history)
        # Each save appends a new row; read the most recent row to get current config
        conn.execute("""
            CREATE TABLE IF NOT EXISTS video_layout_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_width INTEGER NOT NULL,
                frame_height INTEGER NOT NULL,
                crop_left INTEGER NOT NULL,
                crop_top INTEGER NOT NULL,
                crop_right INTEGER NOT NULL,
                crop_bottom INTEGER NOT NULL,
                selection_left INTEGER,
                selection_top INTEGER,
                selection_right INTEGER,
                selection_bottom INTEGER,
                selection_mode TEXT DEFAULT 'disabled',
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
                crop_bounds_version INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_layout_config_created ON video_layout_config(created_at DESC)"
        )
        print("[layout.db] Created video_layout_config table (append-only)")
        # No initial row - inserted when user saves layout configuration

        # Create full_frame_box_labels table (user annotations)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS full_frame_box_labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                frame_index INTEGER NOT NULL,
                box_index INTEGER NOT NULL,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(frame_index, box_index)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_box_labels_frame ON full_frame_box_labels(frame_index)"
        )

        # Create box_classification_model table (trained model parameters)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS box_classification_model (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                model_type TEXT NOT NULL DEFAULT 'naive_bayes',
                model_data BLOB,
                training_samples INTEGER DEFAULT 0,
                accuracy REAL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
        print("[layout.db] Schema created successfully (all tables empty)")

    except Exception as e:
        conn.close()
        raise RuntimeError(f"Failed to create layout.db schema: {e}") from e
    finally:
        conn.close()

    return {
        "db_path": str(layout_db_path),
        "status": "created",
    }


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
    virtual_path: str,
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
        virtual_path: Virtual file path for display (e.g., "folder1/video") - stored in database (required)
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
            video_path=virtual_path,
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
            tenant_id=tenant_id,
            video_id=video_id,
            video_db_path=str(video_db_path),
            output_ocr_db_path=str(full_ocr_db_path),
        )

        # Check if OCR completely failed
        if ocr_result.get("status") == "failed":
            failed_batches = ocr_result.get("failed_batches", "unknown")
            raise RuntimeError(
                f"OCR processing failed: all {failed_batches} batches failed. "
                "Check OCR service logs and Wasabi credentials."
            )

        # Step 7: Upload fullOCR.db to Wasabi
        print("\n📤 Step 7/9: Uploading fullOCR.db to Wasabi...")
        upload_database_to_wasabi(
            local_db_path=str(full_ocr_db_path),
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="fullOCR.db",
        )

        # Step 8: Create empty layout.db
        print("\n📝 Step 8/9: Creating empty layout.db...")
        layout_db_path = video_dir / "layout.db"
        create_layout_db(output_path=str(layout_db_path))

        # Step 9: Upload layout.db to Wasabi
        print("\n📤 Step 9/9: Uploading layout.db to Wasabi...")
        upload_database_to_wasabi(
            local_db_path=str(layout_db_path),
            tenant_id=tenant_id,
            video_id=video_id,
            db_name="layout.db",
        )

        # Step 10: Index OCR content for search
        print("\n🔍 Step 10/9: Indexing OCR content for search...")
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
