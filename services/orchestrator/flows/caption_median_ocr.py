"""
Caption Median OCR Processing Flow

Handles median frame generation and OCR after boundary annotation changes:
1. Generate per-pixel median frame from caption frame range
2. Run OCR on median frame
3. Update captions table with OCR text
4. Set median_ocr_status and text_pending

This replaces the synchronous OCR processing in apps/captionacc-web/app/routes/api.annotations.$videoId.$id.text.tsx
"""

import io
import json
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from prefect import flow, task


@task(
    name="generate-median-frame",
    retries=2,
    retry_delay_seconds=30,
    tags=["median-frame", "image-processing"],
    log_prints=True,
)
def generate_median_frame(
    db_path: str,
    caption_id: int,
    output_path: str,
) -> dict[str, Any]:
    """
    Generate per-pixel median frame from caption's cropped frame range.

    Args:
        db_path: Path to captions.db
        caption_id: Caption ID to process
        output_path: Path to save median frame image

    Returns:
        Dict with output_path, frame_count, and frame range
    """
    print(f"Generating median frame for caption {caption_id}")

    conn = sqlite3.connect(db_path)
    try:
        # Get caption frame range
        cursor = conn.execute(
            "SELECT start_frame_index, end_frame_index FROM captions WHERE id = ?",
            (caption_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Caption {caption_id} not found")

        start_frame, end_frame = row
        print(f"Frame range: {start_frame} to {end_frame}")

        # Load all frames in range from cropped_frames
        cursor = conn.execute(
            """
            SELECT image_data
            FROM cropped_frames
            WHERE frame_index >= ? AND frame_index <= ?
            ORDER BY frame_index
            """,
            (start_frame, end_frame),
        )

        # Convert BLOBs to numpy arrays
        frames = []
        for (blob,) in cursor.fetchall():
            img = Image.open(io.BytesIO(blob))
            frames.append(np.array(img))

        if not frames:
            raise ValueError(f"No frames found in range {start_frame}-{end_frame}")

        print(f"Loaded {len(frames)} frames")

        # Calculate per-pixel median
        frames_array = np.array(frames)
        median_frame = np.median(frames_array, axis=0).astype(np.uint8)

        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # Save as JPEG with high quality
        Image.fromarray(median_frame).save(output_path, "JPEG", quality=95)

        print(f"Median frame saved to: {output_path}")

        return {
            "output_path": output_path,
            "frame_count": len(frames),
            "start_frame": start_frame,
            "end_frame": end_frame,
        }

    finally:
        conn.close()

@task(
    name="run-ocr-on-median-frame",
    retries=2,
    retry_delay_seconds=30,
    tags=["ocr", "text-extraction"],
    log_prints=True,
)
def run_ocr_on_median_frame(
    image_path: str,
    language: str = "zh-Hans",
) -> str:
    """
    Run OCR on median frame using existing run-frame-ocr.py script.

    Args:
        image_path: Path to median frame image
        language: OCR language preference

    Returns:
        Extracted text from OCR
    """
    print(f"Running OCR on {image_path}")
    print(f"Language: {language}")

    # Get path to OCR script
    script_path = (
        Path(__file__).parent.parent.parent
        / "apps"
        / "captionacc-web"
        / "scripts"
        / "run-frame-ocr.py"
    )

    if not script_path.exists():
        raise FileNotFoundError(f"OCR script not found at {script_path}")

    # Run OCR script
    result = subprocess.run(
        ["python3", str(script_path), "--single", image_path, language],
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        print(f"OCR stderr: {result.stderr}")
        raise RuntimeError(f"OCR process failed with code {result.returncode}: {result.stderr}")

    print(f"OCR stdout: {result.stdout[:200]}")

    # Parse OCR result
    try:
        ocr_result = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse OCR output as JSON: {e}")

    if ocr_result.get("error"):
        raise RuntimeError(f"OCR error: {ocr_result['error']}")

    extracted_text = ocr_result.get("text", "")
    print(f"Extracted text length: {len(extracted_text)}")

    return extracted_text

@task(
    name="update-caption-ocr-result",
    tags=["database"],
    log_prints=True,
)
def update_caption_ocr_result(
    db_path: str,
    caption_id: int,
    ocr_text: str,
) -> None:
    """
    Update caption with OCR result and set status flags.

    Args:
        db_path: Path to captions.db
        caption_id: Caption ID to update
        ocr_text: OCR extracted text
    """
    print(f"Updating caption {caption_id} with OCR result")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            UPDATE captions
            SET text_ocr_combined = ?,
                median_ocr_status = 'complete',
                median_ocr_processed_at = datetime('now'),
                text_pending = 1
            WHERE id = ?
            """,
            (ocr_text, caption_id),
        )
        conn.commit()

        print(f"Caption {caption_id} updated successfully")

    finally:
        conn.close()

@task(
    name="update-caption-ocr-status",
    tags=["database"],
    log_prints=True,
)
def update_caption_ocr_status(
    db_path: str,
    caption_id: int,
    status: str,
    error_message: str | None = None,
) -> None:
    """
    Update caption median_ocr_status field.

    Args:
        db_path: Path to captions.db
        caption_id: Caption ID to update
        status: New status value
        error_message: Optional error message for 'error' status
    """
    print(f"Updating caption {caption_id} status to: {status}")

    conn = sqlite3.connect(db_path)
    try:
        if status == "error":
            conn.execute(
                """
                UPDATE captions
                SET median_ocr_status = ?,
                    median_ocr_error = ?
                WHERE id = ?
                """,
                (status, error_message, caption_id),
            )
        else:
            conn.execute(
                """
                UPDATE captions
                SET median_ocr_status = ?
                WHERE id = ?
                """,
                (status, caption_id),
            )

        conn.commit()

    finally:
        conn.close()

@flow(
    name="process-caption-median-ocr",
    log_prints=True,
    retries=1,
    retry_delay_seconds=60,
)
def caption_median_ocr_flow(
    video_id: str,
    db_path: str,
    video_dir: str,
    caption_ids: list[int],
    language: str = "zh-Hans",
) -> dict[str, Any]:
    """
    Process median frame OCR for modified captions.

    This flow:
    1. Generates per-pixel median frame for each caption
    2. Runs OCR on median frame
    3. Updates caption with OCR text and sets text_pending flag

    Priority: High (user is actively annotating boundaries)

    Args:
        video_id: Video UUID
        db_path: Path to captions.db
        video_dir: Video directory path
        caption_ids: List of caption IDs to process
        language: OCR language preference

    Returns:
        Dict with video_id, status, and processed count
    """
    print(f"Starting median OCR processing for video: {video_id}")
    print(f"Processing {len(caption_ids)} captions")

    processed_count = 0
    failed_count = 0
    errors = []

    for caption_id in caption_ids:
        try:
            print(f"\n=== Processing caption {caption_id} ===")

            # Update status to processing
            update_caption_ocr_status(db_path, caption_id, "processing")

            # Generate median frame
            output_path = f"{video_dir}/text_images/annotation_{caption_id}.jpg"
            median_result = generate_median_frame(
                db_path=db_path,
                caption_id=caption_id,
                output_path=output_path,
            )

            # Run OCR
            ocr_text = run_ocr_on_median_frame(
                image_path=median_result["output_path"],
                language=language,
            )

            # Update caption with result
            update_caption_ocr_result(
                db_path=db_path,
                caption_id=caption_id,
                ocr_text=ocr_text,
            )

            processed_count += 1
            print(f"✓ Caption {caption_id} processed successfully")

        except Exception as e:
            failed_count += 1
            error_msg = f"Caption {caption_id}: {str(e)}"
            errors.append(error_msg)
            print(f"✗ {error_msg}")

            # Update status to error
            update_caption_ocr_status(
                db_path=db_path,
                caption_id=caption_id,
                status="error",
                error_message=str(e),
            )

    print("\n=== Processing Complete ===")
    print(f"Processed: {processed_count}/{len(caption_ids)}")
    print(f"Failed: {failed_count}/{len(caption_ids)}")

    if errors:
        print("Errors:")
        for error in errors:
            print(f"  - {error}")
    return {
        "video_id": video_id,
        "status": "completed" if failed_count == 0 else "partial",
        "processed_count": processed_count,
        "failed_count": failed_count,
        "errors": errors,
    }
