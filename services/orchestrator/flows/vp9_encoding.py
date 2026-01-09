"""
VP9 Encoding Flow

Handles VP9 encoding and Wasabi upload after frame extraction:
1. Encode frames to VP9 WebM chunks
2. Upload chunks to Wasabi
3. Update vp9_encoding_status table

This runs as a deferred background job after frame extraction completes.
"""

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

from frames_db.storage import (
    init_vp9_encoding_status,
    update_vp9_encoding_status,
)
from prefect import flow, task
from vp9_utils import encode_video_chunks, upload_chunks_to_wasabi

FrameType = Literal["cropped", "full"]

logger = logging.getLogger(__name__)

@task(
    name="encode-vp9-chunks",
    retries=2,
    retry_delay_seconds=60,
    tags=["vp9-encoding", "wasabi"],
    log_prints=True,
)
def encode_vp9_chunks_task(
    db_path: str,
    video_id: str,
    frame_type: FrameType,
    modulo_levels: list[int] | None = None,
) -> dict[str, Any]:
    """
    Encode frames to VP9 WebM chunks.

    Args:
        db_path: Path to captions.db
        video_id: Video UUID
        frame_type: "cropped" or "full"
        modulo_levels: List of modulo levels (defaults: cropped=[16,4,1], full=[1])

    Returns:
        Dict with encoding results
    """
    db_path_obj = Path(db_path)

    print(f"Encoding {frame_type} frames for video {video_id}")
    print(f"Database: {db_path}")

    # Auto-select modulo levels
    if modulo_levels is None:
        modulo_levels = [16, 4, 1] if frame_type == "cropped" else [1]

    print(f"Modulo levels: {modulo_levels}")

    # Initialize status in database
    init_vp9_encoding_status(
        db_path=db_path_obj,
        video_id=video_id,
        frame_type=frame_type,
        modulo_levels=modulo_levels,
    )

    # Update status to encoding
    update_vp9_encoding_status(
        db_path=db_path_obj,
        video_id=video_id,
        frame_type=frame_type,
        status="encoding",
    )

    # Create temporary output directory
    with tempfile.TemporaryDirectory() as temp_dir:
        output_dir = Path(temp_dir)

        try:
            # Encode chunks
            result = encode_video_chunks(
                db_path=db_path_obj,
                video_id=video_id,
                frame_type=frame_type,
                output_dir=output_dir,
                modulo_levels=modulo_levels,
                frames_per_chunk=32,
                crf=30,
                progress_callback=lambda curr, total: print(
                    f"Encoding progress: {curr}/{total} chunks"
                ),
            )

            print(
                f"Encoding complete: {result['chunks_encoded']} chunks, {result['total_frames']} frames"
            )

            # Update database with encoding results
            update_vp9_encoding_status(
                db_path=db_path_obj,
                video_id=video_id,
                frame_type=frame_type,
                chunks_encoded=result["chunks_encoded"],
                status="uploading",
            )

            return {
                "status": "success",
                "chunks_encoded": result["chunks_encoded"],
                "total_frames": result["total_frames"],
                "chunk_files": result["chunk_files"],
            }

        except Exception as e:
            print(f"Encoding failed: {str(e)}")

            # Update status to failed
            update_vp9_encoding_status(
                db_path=db_path_obj,
                video_id=video_id,
                frame_type=frame_type,
                status="failed",
                error_message=str(e),
            )

            raise

@task(
    name="upload-vp9-chunks-to-wasabi",
    retries=3,
    retry_delay_seconds=[30, 60, 120],  # Exponential backoff
    tags=["wasabi", "upload"],
    log_prints=True,
)
def upload_vp9_chunks_task(
    db_path: str,
    video_id: str,
    frame_type: FrameType,
    chunk_files: list[Path],
) -> dict[str, Any]:
    """
    Upload VP9 chunks to Wasabi S3.

    Args:
        db_path: Path to captions.db
        video_id: Video UUID
        frame_type: "cropped" or "full"
        chunk_files: List of local chunk file paths

    Returns:
        Dict with upload results
    """
    db_path_obj = Path(db_path)

    print(f"Uploading {len(chunk_files)} chunks to Wasabi")

    # Get environment
    environment = os.getenv("ENVIRONMENT", "dev")
    print(f"Environment: {environment}")

    try:
        # Upload chunks
        result = upload_chunks_to_wasabi(
            chunk_files=chunk_files,
            video_id=video_id,
            frame_type=frame_type,
            user_id="default_user",  # TODO: Replace with actual user ID from Supabase
            environment=environment,
            progress_callback=lambda curr, total: print(f"Upload progress: {curr}/{total} chunks"),
        )

        print(
            f"Upload complete: {result['chunks_uploaded']} chunks, {result['total_size_bytes'] / 1024 / 1024:.1f} MB"
        )

        # Update database with upload results
        update_vp9_encoding_status(
            db_path=db_path_obj,
            video_id=video_id,
            frame_type=frame_type,
            chunks_uploaded=result["chunks_uploaded"],
            status="completed",
            wasabi_available=True,
        )

        return {
            "status": "success",
            "chunks_uploaded": result["chunks_uploaded"],
            "total_size_bytes": result["total_size_bytes"],
            "s3_keys": result["s3_keys"],
        }

    except Exception as e:
        print(f"Upload failed: {str(e)}")

        # Update status to failed
        update_vp9_encoding_status(
            db_path=db_path_obj,
            video_id=video_id,
            frame_type=frame_type,
            status="failed",
            error_message=f"Upload failed: {str(e)}",
        )

        raise

@flow(
    name="encode-and-upload-vp9-chunks",
    description="Encode frames to VP9 chunks and upload to Wasabi",
    log_prints=True,
)
def encode_vp9_chunks_flow(
    video_id: str,
    db_path: str,
    frame_type: FrameType = "cropped",
    modulo_levels: list[int] | None = None,
) -> dict[str, Any]:
    """
    Main flow for VP9 encoding and Wasabi upload.

    This runs as a deferred background job after frame extraction.

    Args:
        video_id: Video UUID
        db_path: Path to captions.db
        frame_type: "cropped" or "full"
        modulo_levels: List of modulo levels (optional, auto-selected if None)

    Returns:
        Dict with encoding and upload results
    """
    print("=" * 80)
    print(f"VP9 Encoding Flow: {video_id}")
    print(f"Frame type: {frame_type}")
    print("=" * 80)

    # Step 1: Encode chunks
    encoding_result = encode_vp9_chunks_task(
        db_path=db_path,
        video_id=video_id,
        frame_type=frame_type,
        modulo_levels=modulo_levels,
    )

    # Step 2: Upload to Wasabi
    upload_result = upload_vp9_chunks_task(
        db_path=db_path,
        video_id=video_id,
        frame_type=frame_type,
        chunk_files=encoding_result["chunk_files"],
    )

    print("=" * 80)
    print(f"VP9 Encoding Complete: {video_id}")
    print(f"Chunks encoded: {encoding_result['chunks_encoded']}")
    print(f"Chunks uploaded: {upload_result['chunks_uploaded']}")
    print(f"Total size: {upload_result['total_size_bytes'] / 1024 / 1024:.1f} MB")
    print("=" * 80)

    return {
        "video_id": video_id,
        "frame_type": frame_type,
        "status": "completed",
        "chunks_encoded": encoding_result["chunks_encoded"],
        "chunks_uploaded": upload_result["chunks_uploaded"],
        "total_frames": encoding_result["total_frames"],
        "total_size_bytes": upload_result["total_size_bytes"],
    }
