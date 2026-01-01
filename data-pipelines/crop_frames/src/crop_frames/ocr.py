"""OCR processing for cropped frames using macOS LiveText API.

This module provides OCR functionality for the crop_frames pipeline, processing
cropped caption frames and storing results in the cropped_frame_ocr table.
"""

from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from ocr_utils import (
    ensure_ocr_table,
    process_frame_ocr_with_retry,
    write_ocr_result_to_database,
)

__all__ = [
    "process_frames_to_database",
]


def process_frames_to_database(
    frames_dir: Path,
    db_path: Path,
    crop_bounds_version: int,
    language: str = "zh-Hans",
    progress_callback: callable | None = None,
    max_workers: int = 1,
) -> int:
    """Process all frames in a directory with OCR and write to database.

    Runs OCR on cropped frames and writes results to cropped_frame_ocr table.
    Coordinates are stored relative to the cropped frame.

    Args:
        frames_dir: Directory containing frame images
        db_path: Path to annotations.db file
        crop_bounds_version: Crop bounds version from video_layout_config
        language: OCR language preference (default: "zh-Hans")
        progress_callback: Optional callback (current, total) -> None
        max_workers: Maximum concurrent OCR workers (default: 1 for macOS OCR)

    Returns:
        Total number of OCR boxes inserted into database
    """
    # Ensure table exists with correct schema
    ensure_ocr_table(db_path, table_name="cropped_frame_ocr", include_crop_version=True)

    # Find all frame images
    frame_files = sorted(frames_dir.glob("frame_*.jpg"))
    if not frame_files:
        raise FileNotFoundError(f"No frame images found in {frames_dir}")

    total = len(frame_files)
    total_boxes = 0

    # Process with worker pool
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Submit all frames to worker pool
        futures = {
            executor.submit(process_frame_ocr_with_retry, frame_path, language): frame_path
            for frame_path in frame_files
        }

        # Collect and write results as they complete
        completed_count = 0
        for future in as_completed(futures):
            frame_path = futures[future]
            try:
                ocr_result = future.result()

                # Write to database using shared function
                boxes_inserted = write_ocr_result_to_database(
                    ocr_result=ocr_result,
                    db_path=db_path,
                    table_name="cropped_frame_ocr",
                    crop_bounds_version=crop_bounds_version,
                )
                total_boxes += boxes_inserted

                completed_count += 1
                if progress_callback:
                    progress_callback(completed_count, total)

            except Exception as e:
                print(f"UNEXPECTED ERROR processing {frame_path.name}: {e}")

    return total_boxes
