"""Pipeline for GPU-accelerated full frame extraction and OCR processing.

Uses:
- gpu_video_utils for GPU frame extraction
- ocr package for OCR processing (backend auto-selected by environment)
"""

from collections.abc import Callable
from pathlib import Path

from gpu_video_utils import extract_frames_gpu
from ocr import (
    ensure_ocr_table,
    get_backend,
    process_frames_with_ocr,
    write_ocr_result_to_database,
)


def process_video_with_gpu_and_ocr(
    video_path: Path,
    db_path: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
    progress_callback: Callable[[int, int], None] | None = None,
) -> tuple[int, int, dict]:
    """Extract frames with GPU and process with OCR.

    Pipeline:
    1. Extract frames using gpu_video_utils.extract_frames_gpu()
    2. Extract video metadata (duration, dimensions, etc.)
    3. Initialize GoogleVisionBackend from ocr package
    4. Calculate batch sizes using ocr.batch functions (done automatically)
    5. Process frames with ocr.process_frames_with_ocr()
    6. Write results to database using ocr.database functions

    Args:
        video_path: Path to video file
        db_path: Path for output fullOCR.db
        rate_hz: Frame extraction rate (default: 0.1 = 1 frame per 10 seconds)
        language: OCR language hint (default: "zh-Hans")
        progress_callback: Optional callback(current, total) for progress tracking

    Returns:
        Tuple of (total_ocr_boxes, failed_ocr_count, video_info_dict, jpeg_frames)
        - total_ocr_boxes: Total number of OCR boxes detected
        - failed_ocr_count: Number of frames that failed OCR processing
        - video_info_dict: Dict with keys: fps, width, height, duration, total_frames, codec, bitrate
        - jpeg_frames: List of JPEG byte arrays for each extracted frame

    Example:
        >>> from pathlib import Path
        >>> video = Path("video.mp4")
        >>> db = Path("fullOCR.db")
        >>> total_boxes, failed, video_info = process_video_with_gpu_and_ocr(video, db, rate_hz=0.1)
        >>> print(f"Processed {total_boxes} text boxes from {video_info['duration']:.1f}s video ({failed} failed)")
    """
    print("[Pipeline] Starting GPU-accelerated OCR pipeline")
    print(f"[Pipeline] Video: {video_path}")
    print(f"[Pipeline] Database: {db_path}")
    print(f"[Pipeline] Rate: {rate_hz} Hz")
    print(f"[Pipeline] Language: {language}")

    # Step 1: Extract video metadata
    print("\n[Video] Extracting video metadata...")
    from gpu_video_utils import GPUVideoDecoder

    decoder = GPUVideoDecoder(video_path)
    video_info = decoder.get_video_info()
    print(f"[Video] Duration: {video_info['duration']:.1f}s")
    print(f"[Video] Dimensions: {video_info['width']}x{video_info['height']}")
    print(f"[Video] FPS: {video_info['fps']:.2f}")
    print(f"[Video] Total frames: {video_info['total_frames']}")

    # Step 2: Extract frames using GPU with JPEG bytes output
    print(f"\n[GPU] Extracting frames at {rate_hz} Hz...")
    jpeg_frames = extract_frames_gpu(
        video_path=video_path,
        frame_rate_hz=rate_hz,
        output_format="jpeg_bytes",
        progress_callback=progress_callback,
    )

    if not jpeg_frames:
        print("[GPU] No frames extracted")
        return 0, 0, video_info, []

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

    # Step 3: Initialize OCR backend (auto-selected based on ENVIRONMENT)
    print("\n[OCR] Initializing OCR backend...")
    import os

    env = os.environ.get("ENVIRONMENT", "unknown")
    ocr_backend_override = os.environ.get("OCR_BACKEND", "auto")
    print(f"[OCR] Environment: {env}, OCR_BACKEND: {ocr_backend_override}")
    backend = get_backend()
    print(f"[OCR] Backend: {backend.__class__.__name__}")
    print(f"[OCR] Constraints: {backend.get_constraints()}")

    # Step 4: Process frames with OCR (automatic batching via montage)
    print(f"\n[OCR] Processing {len(frames)} frames with automatic montage batching...")
    ocr_results, failed_ocr_count = process_frames_with_ocr(
        frames=frames,
        backend=backend,
        language=language,
    )
    print(f"[OCR] Received {len(ocr_results)} OCR results ({failed_ocr_count} failed)")

    # Step 5: Ensure database table exists
    print("\n[DB] Ensuring OCR table exists...")
    ensure_ocr_table(db_path, table_name="full_frame_ocr")

    # Step 6: Convert OCRResults to database format and write
    print("[DB] Writing OCR results to database...")
    total_boxes = 0

    # Derive framework name from backend class (e.g., GoogleVisionBackend -> google_vision)
    backend_name = backend.__class__.__name__
    framework_name = backend_name.replace("Backend", "").lower()
    if framework_name == "livetext":
        framework_name = "livetext"
    elif framework_name == "googlevision":
        framework_name = "google_vision"

    for ocr_result in ocr_results:
        # Convert OCRResult to database format
        # Frame ID format: "frame_0000000100" -> extract the numeric index
        frame_index = int(ocr_result.id.split("_")[1])

        # Build annotations list: [[text, confidence, [x, y, width, height]], ...]
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
            "framework": framework_name,
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
        f"\n[Pipeline] Complete! Processed {len(frames)} frames with {total_boxes} text boxes ({failed_ocr_count} failed)"
    )

    return total_boxes, failed_ocr_count, video_info, jpeg_frames


def process_frames_with_ocr_only(
    jpeg_frames: list[bytes],
    db_path: Path,
    rate_hz: float = 0.1,
    language: str = "zh-Hans",
) -> tuple[int, int]:
    """Process already-extracted frames with OCR only.

    Use this when frames have already been extracted and you only need OCR processing.
    This is useful for parallel processing where frames are uploaded while OCR runs.

    Args:
        jpeg_frames: List of JPEG byte arrays
        db_path: Path for output database
        rate_hz: Frame extraction rate used (for frame index calculation)
        language: OCR language hint (default: "zh-Hans")

    Returns:
        Tuple of (total_ocr_boxes, failed_ocr_count)
    """
    # Initialize OCR backend (auto-selected based on ENVIRONMENT)
    backend = get_backend()
    print(f"[OCR] Processing {len(jpeg_frames)} frames with {backend.__class__.__name__}...")

    # Create frame tuples with proper frame IDs
    frames = []
    for frame_num, jpeg_bytes in enumerate(jpeg_frames):
        timestamp = frame_num / rate_hz
        frame_index = int(timestamp * 10)
        frame_id = f"frame_{frame_index:010d}"
        frames.append((frame_id, jpeg_bytes))

    # Process frames with OCR
    ocr_results, failed_ocr_count = process_frames_with_ocr(
        frames=frames,
        backend=backend,
        language=language,
    )
    print(f"[OCR] Received {len(ocr_results)} OCR results ({failed_ocr_count} failed)")

    # Ensure database table exists
    ensure_ocr_table(db_path, table_name="full_frame_ocr")

    # Derive framework name from backend class
    backend_name = backend.__class__.__name__
    framework_name = backend_name.replace("Backend", "").lower()
    if framework_name == "livetext":
        framework_name = "livetext"
    elif framework_name == "googlevision":
        framework_name = "google_vision"

    # Write OCR results to database
    total_boxes = 0
    for ocr_result in ocr_results:
        frame_index = int(ocr_result.id.split("_")[1])

        annotations = []
        for char in ocr_result.characters:
            annotations.append(
                [
                    char.text,
                    1.0,
                    [char.bbox.x, char.bbox.y, char.bbox.width, char.bbox.height],
                ]
            )

        db_record = {
            "image_path": f"frames/{ocr_result.id}.jpg",
            "framework": framework_name,
            "annotations": annotations,
        }

        boxes_inserted = write_ocr_result_to_database(
            ocr_result=db_record,
            db_path=db_path,
            table_name="full_frame_ocr",
        )
        total_boxes += boxes_inserted

    print(f"[OCR] Wrote {total_boxes} total OCR boxes to database")
    return total_boxes, failed_ocr_count
