#!/usr/bin/env python3
"""
Reprocess Video OCR - Rerun OCR processing for a video

This script:
1. Downloads video.db from Wasabi
2. Processes all frames through the OCR service
3. Creates/updates fullOCR.db with results
4. Uploads fullOCR.db back to Wasabi
5. Updates search index in Supabase
"""

import math
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

# Load environment variables from .env
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value

# Add orchestrator to path
sys.path.insert(0, str(Path(__file__).parent / "services" / "orchestrator"))

from ocr_client import get_ocr_client
from supabase_client import SearchIndexRepository
from wasabi_client import get_wasabi_client


def reprocess_video_ocr(video_id: str, tenant_id: str = "00000000-0000-0000-0000-000000000001"):
    """
    Reprocess OCR for a video.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID (default: demo tenant)
    """
    print(f"🔍 Reprocessing OCR for video {video_id}")
    print("=" * 70)

    # Initialize clients
    wasabi_client = get_wasabi_client()
    ocr_client = get_ocr_client()

    # Define storage keys
    video_db_key = f"{tenant_id}/{video_id}/video.db"
    full_ocr_db_key = f"{tenant_id}/{video_id}/fullOCR.db"

    # Create temporary directory for work
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        video_db_path = tmpdir_path / "video.db"
        full_ocr_db_path = tmpdir_path / "fullOCR.db"

        # Step 1: Download video.db
        print("\n📥 Step 1/5: Downloading video.db from Wasabi...")
        wasabi_client.download_file(video_db_key, str(video_db_path))
        print(f"✓ Downloaded to {video_db_path}")

        # Step 2: Read frame count and dimensions from video.db
        print("\n📊 Step 2/5: Reading frame metadata from video.db...")
        video_conn = sqlite3.connect(str(video_db_path))
        try:
            cursor = video_conn.execute(
                """
                SELECT frame_index, width, height
                FROM full_frames
                ORDER BY frame_index
            """
            )

            frame_metadata = cursor.fetchall()
            total_frames = len(frame_metadata)

            if total_frames == 0:
                print("⚠️  No frames found in video.db")
                return

            print(f"✓ Found {total_frames} frames to process")

            # Get frame dimensions and all frame indices
            _, width, height = frame_metadata[0]
            all_frame_indices = [frame_index for frame_index, _, _ in frame_metadata]
            print(f"  Frame dimensions: {width}×{height}")

        finally:
            video_conn.close()

        # Step 3: Check capacity and process with OCR
        print("\n🔍 Step 3/5: Processing frames with OCR service...")
        print("  Note: OCR service will download video.db directly from Wasabi")

        # Check capacity
        capacity = ocr_client.get_capacity(width, height)
        max_batch_size = capacity["max_images"]
        print(f"  Max batch size: {max_batch_size} (limited by {capacity['limiting_factor']})")

        # Calculate optimal batch size
        if total_frames <= max_batch_size:
            batch_size = total_frames
            num_batches = 1
        else:
            num_batches = math.ceil(total_frames / max_batch_size)
            batch_size = math.ceil(total_frames / num_batches)

        print(f"  Processing {total_frames} frames in {num_batches} batch(es) of ~{batch_size} frames each")

        # Create fullOCR.db with schema
        ocr_conn = sqlite3.connect(str(full_ocr_db_path))
        try:
            ocr_conn.execute(
                """
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
            """
            )
            ocr_conn.execute("CREATE INDEX IF NOT EXISTS idx_frame_index ON full_frame_ocr(frame_index)")
            ocr_conn.commit()

            # Process frames in batches
            total_detections = 0

            for batch_start in range(0, total_frames, batch_size):
                batch_end = min(batch_start + batch_size, total_frames)
                batch_frame_indices = all_frame_indices[batch_start:batch_end]

                batch_num = batch_start // batch_size + 1
                print(f"\n  Batch {batch_num}/{num_batches} ({batch_end - batch_start} frames)...")

                # Submit to OCR service and wait for results
                # OCR service will download video.db and extract these frames
                try:
                    result = ocr_client.process_batch(
                        tenant_id=tenant_id, video_id=video_id, frame_indices=batch_frame_indices, timeout=600
                    )  # 10min timeout

                    print(
                        f"    ✓ {result['total_characters']} characters detected in {result['processing_time_ms']:.0f}ms"
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
                                    1.0,  # Google Vision doesn't provide per-char confidence
                                    bbox["x"],
                                    bbox["y"],
                                    bbox["x"] + bbox["width"],
                                    bbox["y"] + bbox["height"],
                                ),
                            )

                    ocr_conn.commit()
                    total_detections += result["total_characters"]

                except Exception as e:
                    print(f"    ✗ Batch {batch_num} failed: {e}")
                    raise  # Don't continue if OCR fails

            print(f"\n✓ OCR processing complete: {total_detections} total character detections")

        finally:
            ocr_conn.close()

        # Step 4: Upload fullOCR.db to Wasabi
        print("\n📤 Step 4/5: Uploading fullOCR.db to Wasabi...")
        wasabi_client.upload_file(
            local_path=str(full_ocr_db_path),
            storage_key=full_ocr_db_key,
            content_type="application/x-sqlite3",
        )
        print(f"✓ Uploaded to {full_ocr_db_key}")

        # Step 5: Update search index in Supabase
        print("\n🔍 Step 5/5: Updating search index in Supabase...")
        indexed_count = 0
        try:
            search_repo = SearchIndexRepository()
            ocr_conn = sqlite3.connect(str(full_ocr_db_path))

            try:
                cursor = ocr_conn.execute(
                    """
                    SELECT frame_index, GROUP_CONCAT(text, ' ') as ocr_text
                    FROM full_frame_ocr
                    WHERE text IS NOT NULL AND text != ''
                    GROUP BY frame_index
                    ORDER BY frame_index
                    """
                )

                for row in cursor:
                    frame_index, ocr_text = row
                    if ocr_text:
                        search_repo.upsert_frame_text(
                            video_id=video_id,
                            frame_index=frame_index,
                            ocr_text=ocr_text,
                        )
                        indexed_count += 1

                print(f"✓ Indexed {indexed_count} frames for search")

            finally:
                ocr_conn.close()

        except Exception as e:
            print(f"⚠️  Warning: Failed to update search index: {e}")

    print("\n" + "=" * 70)
    print(f"✅ Reprocessing complete!")
    print(f"   Total frames: {total_frames}")
    print(f"   OCR detections: {total_detections}")
    print(f"   Frames indexed: {indexed_count}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python reprocess_video_ocr.py <video_id> [tenant_id]")
        print("\nExample:")
        print("  python reprocess_video_ocr.py c42fd2cf-e06a-444a-aa38-09c0fb40ae5a")
        sys.exit(1)

    video_id = sys.argv[1]
    tenant_id = sys.argv[2] if len(sys.argv) > 2 else "00000000-0000-0000-0000-000000000001"

    reprocess_video_ocr(video_id, tenant_id)
