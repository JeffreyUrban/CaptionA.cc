"""GPU-accelerated frame extraction with OCR service integration.

This module provides end-to-end GPU-accelerated processing using:
1. GPU frame extraction (gpu_video_utils)
2. OCR service montage processing (ocr_utils.OCRServiceAdapter)
3. Database storage (frames_db)
"""

import tempfile
from collections.abc import Callable
from pathlib import Path

from gpu_video_utils import GPUVideoDecoder, calculate_montage_capacity
from ocr_utils import OCRServiceAdapter, ensure_ocr_table, write_ocr_result_to_database

from .frames_gpu import extract_frames_gpu
from .database import write_frames_to_database


def process_video_with_gpu_and_ocr_service(
    video_path: Path,
    db_path: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
    progress_callback: Callable[[int, int], None] | None = None,
) -> int:
    """Process video with GPU extraction and OCR service.

    End-to-end pipeline:
    1. Extract frames on GPU and save to temporary directory
    2. Query OCR service for optimal batch size
    3. Process frames in batches using OCRServiceAdapter
    4. Write results to database
    5. Write frame images to database and clean up

    Args:
        video_path: Path to video file
        db_path: Path to fullOCR.db database
        rate_hz: Frame sampling rate in Hz (default: 0.1 = 1 frame per 10s)
        language: OCR language preference (default: "zh-Hans")
        progress_callback: Optional callback (current, total) -> None

    Returns:
        Total number of OCR boxes inserted into database

    Example:
        >>> from pathlib import Path
        >>> video = Path("video.mp4")
        >>> db = Path("output/fullOCR.db")
        >>> total_boxes = process_video_with_gpu_and_ocr_service(video, db, rate_hz=0.1)
        >>> print(f"Processed {total_boxes} text boxes")
    """
    # Ensure table exists
    ensure_ocr_table(db_path, table_name="full_frame_ocr")

    # Initialize OCR service adapter
    ocr_adapter = OCRServiceAdapter()

    # Health check
    if not ocr_adapter.health_check():
        raise RuntimeError(
            "OCR service is unavailable. Please ensure the OCR service is running. "
            "See services/ocr-service/README.md for setup instructions."
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir = Path(tmpdir) / "frames"
        frames_dir.mkdir()

        # Step 1: Extract frames on GPU
        print(f"[GPU] Extracting frames at {rate_hz} Hz...")
        frame_paths = extract_frames_gpu(
            video_path=video_path,
            output_dir=frames_dir,
            rate_hz=rate_hz,
            crop_box=None,  # No cropping for full frames
            progress_callback=progress_callback,
        )

        if not frame_paths:
            print("No frames extracted")
            return 0

        print(f"[GPU] Extracted {len(frame_paths)} frames")

        # Step 2: Determine optimal batch size
        # Get frame dimensions from first frame
        decoder = GPUVideoDecoder(video_path)
        video_info = decoder.get_video_info()
        frame_width = video_info["width"]
        frame_height = video_info["height"]
        decoder.close()

        # Calculate capacity (matches OCR service logic)
        max_batch_size, limits, limiting_factor, estimated_size_mb = calculate_montage_capacity(
            frame_width, frame_height
        )

        print(f"[Capacity] Max batch size: {max_batch_size} frames (limited by: {limiting_factor})")
        print(f"[Capacity] Estimated montage size: {estimated_size_mb:.2f} MB")
        print(f"[Capacity] Limits: {limits}")

        # Step 3: Process frames in batches with OCR service
        print(f"[OCR] Processing {len(frame_paths)} frames in batches of {max_batch_size}...")
        total_boxes = 0
        num_batches = (len(frame_paths) + max_batch_size - 1) // max_batch_size

        for batch_idx in range(num_batches):
            batch_start = batch_idx * max_batch_size
            batch_end = min(batch_start + max_batch_size, len(frame_paths))
            batch_frames = frame_paths[batch_start:batch_end]

            print(f"[OCR] Processing batch {batch_idx + 1}/{num_batches} ({len(batch_frames)} frames)...")

            # Process batch with OCR service
            # OCRServiceAdapter.process_frames_batch() handles:
            # - Montage assembly
            # - Google Vision API call
            # - Character distribution back to individual frames
            ocr_results = ocr_adapter.process_frames_batch(batch_frames, language=language)

            # Write results to database
            for ocr_result in ocr_results:
                boxes_inserted = write_ocr_result_to_database(
                    ocr_result=ocr_result,
                    db_path=db_path,
                    table_name="full_frame_ocr",
                )
                total_boxes += boxes_inserted

        print(f"[OCR] Processed {total_boxes} text boxes across {len(frame_paths)} frames")

        # Step 4: Write frame images to database
        print(f"[DB] Writing {len(frame_paths)} frames to database...")
        frames_written = write_frames_to_database(
            frames_dir=frames_dir,
            db_path=db_path,
            progress_callback=progress_callback,
            delete_after_write=True,  # Clean up temp files
        )
        print(f"[DB] Wrote {frames_written} frames to database")

    return total_boxes
