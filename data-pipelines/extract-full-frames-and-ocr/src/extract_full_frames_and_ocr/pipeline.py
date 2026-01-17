"""Pipeline for GPU-accelerated full frame extraction and OCR processing.

Uses:
- gpu_video_utils for GPU frame extraction
- ocr package for OCR processing with Google Vision backend
"""

from collections.abc import Callable
from pathlib import Path

from gpu_video_utils import extract_frames_gpu
from ocr import (
    GoogleVisionBackend,
    ensure_ocr_table,
    process_frames_with_ocr,
    write_ocr_result_to_database,
)


def process_video_with_gpu_and_ocr(
    video_path: Path,
    db_path: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
    progress_callback: Callable[[int, int], None] | None = None,
) -> int:
    """Extract frames with GPU and process with OCR.

    Pipeline:
    1. Extract frames using gpu_video_utils.extract_frames_gpu()
    2. Initialize GoogleVisionBackend from ocr package
    3. Calculate batch sizes using ocr.batch functions (done automatically)
    4. Process frames with ocr.process_frames_with_ocr()
    5. Write results to database using ocr.database functions

    Args:
        video_path: Path to video file
        db_path: Path for output fullOCR.db
        rate_hz: Frame extraction rate (default: 0.1 = 1 frame per 10 seconds)
        language: OCR language hint (default: "zh-Hans")
        progress_callback: Optional callback(current, total) for progress tracking

    Returns:
        Total number of OCR boxes detected

    Example:
        >>> from pathlib import Path
        >>> video = Path("video.mp4")
        >>> db = Path("fullOCR.db")
        >>> total_boxes = process_video_with_gpu_and_ocr(video, db, rate_hz=0.1)
        >>> print(f"Processed {total_boxes} text boxes")
    """
    print("[Pipeline] Starting GPU-accelerated OCR pipeline")
    print(f"[Pipeline] Video: {video_path}")
    print(f"[Pipeline] Database: {db_path}")
    print(f"[Pipeline] Rate: {rate_hz} Hz")
    print(f"[Pipeline] Language: {language}")

    # Step 1: Extract frames using GPU with JPEG bytes output
    print(f"\n[GPU] Extracting frames at {rate_hz} Hz...")
    jpeg_frames = extract_frames_gpu(
        video_path=video_path,
        frame_rate_hz=rate_hz,
        output_format="jpeg_bytes",
        progress_callback=progress_callback,
    )

    if not jpeg_frames:
        print("[GPU] No frames extracted")
        return 0

    print(f"[GPU] Extracted {len(jpeg_frames)} frames")

    # Step 2: Create frame tuples with proper frame IDs
    # Frame index convention: frame_index = time_in_seconds * 10
    # For rate_hz = 0.1 (1 frame per 10 seconds):
    #   frame 0 at t=0s -> index 0
    #   frame 1 at t=10s -> index 100
    #   frame 2 at t=20s -> index 200
    print("\n[Frames] Creating frame tuples...")
    frames = []
    for frame_num, jpeg_bytes in enumerate(jpeg_frames):
        # Calculate frame index based on timestamp
        timestamp = frame_num / rate_hz
        frame_index = int(timestamp * 10)
        frame_id = f"frame_{frame_index:010d}"
        frames.append((frame_id, jpeg_bytes))

    print(f"[Frames] Created {len(frames)} frame tuples")
    print(f"[Frames] First frame: {frames[0][0]}")
    print(f"[Frames] Last frame: {frames[-1][0]}")

    # Step 3: Initialize Google Vision backend
    print("\n[OCR] Initializing Google Vision backend...")
    import os
    google_env_vars = {k: "SET" for k in os.environ if "GOOGLE" in k or "SERVICE" in k}
    print(f"[DEBUG] Google/Service env vars: {google_env_vars}")
    backend = GoogleVisionBackend()
    print(f"[OCR] Backend initialized with constraints: {backend.get_constraints()}")

    # Step 4: Process frames with OCR (automatic batching via montage)
    print(f"\n[OCR] Processing {len(frames)} frames with automatic montage batching...")
    ocr_results = process_frames_with_ocr(
        frames=frames,
        backend=backend,
        language=language,
    )
    print(f"[OCR] Received {len(ocr_results)} OCR results")

    # Step 5: Ensure database table exists
    print("\n[DB] Ensuring OCR table exists...")
    ensure_ocr_table(db_path, table_name="full_frame_ocr")

    # Step 6: Convert OCRResults to database format and write
    print("[DB] Writing OCR results to database...")
    total_boxes = 0

    for ocr_result in ocr_results:
        # Convert OCRResult to database format
        # Frame ID format: "frame_0000000100" -> extract the numeric index
        frame_index = int(ocr_result.id.split("_")[1])

        # Build annotations list: [[text, confidence, [x, y, width, height]], ...]
        # Note: Google Vision API doesn't provide per-character confidence,
        # so we use 1.0 as a placeholder
        annotations = []
        for char in ocr_result.characters:
            annotations.append(
                [
                    char.text,
                    1.0,  # Confidence placeholder
                    [
                        char.bbox.x,
                        char.bbox.y,
                        char.bbox.width,
                        char.bbox.height,
                    ],
                ]
            )

        # Create database record format
        db_record = {
            "image_path": f"frames/{ocr_result.id}.jpg",
            "framework": "google_vision",
            "annotations": annotations,
        }

        # Write to database
        boxes_inserted = write_ocr_result_to_database(
            ocr_result=db_record,
            db_path=db_path,
            table_name="full_frame_ocr",
        )
        total_boxes += boxes_inserted

    print(f"[DB] Wrote {total_boxes} total OCR boxes to database")
    print(
        f"\n[Pipeline] Complete! Processed {len(frames)} frames with {total_boxes} text boxes"
    )

    return total_boxes
