"""High-level OCR processing with automatic batching via montage."""

from io import BytesIO

from PIL import Image

from .backends.base import OCRBackend
from .batch import calculate_even_batch_size, calculate_max_batch_size
from .models import OCRResult
from .montage import create_vertical_montage, distribute_results_to_images


def process_frames_with_ocr(
    frames: list[tuple[str, bytes]],
    backend: OCRBackend,
    language: str = "zh-Hans",
) -> tuple[list[OCRResult], int]:
    """Process frames with OCR using automatic montage batching.

    High-level processing flow:
    1. Calculate max batch size using backend constraints
    2. Calculate even batch size to distribute frames evenly
    3. For each batch:
       a. Create montage using create_vertical_montage()
       b. Process montage as single image via backend.process_single()
       c. Distribute results using distribute_results_to_images()
    4. Return all OCR results

    Args:
        frames: List of (frame_id, image_bytes) tuples
        backend: OCR backend instance (GoogleVisionBackend or LiveTextBackend)
        language: Language hint for OCR (default: "zh-Hans")

    Returns:
        Tuple of (results, failed_count) where:
        - results: List of OCRResult, one per input frame, in same order as input
        - failed_count: Number of frames that failed OCR processing

    Raises:
        ValueError: If frames list is empty or frame dimensions don't match
    """
    # Handle empty frames list
    if not frames:
        return [], 0

    # Handle single frame - no batching needed
    if len(frames) == 1:
        frame_id, image_bytes = frames[0]
        try:
            result = backend.process_single(image_bytes, language)
            # Return result with the correct frame ID
            return [
                OCRResult(
                    id=frame_id,
                    characters=result.characters,
                    text=result.text,
                    char_count=result.char_count,
                )
            ], 0
        except Exception as e:
            print(f"[OCR] Failed to process frame {frame_id}: {e}")
            # Return empty result for failed frame
            return [
                OCRResult(
                    id=frame_id,
                    characters=[],
                    text="",
                    char_count=0,
                )
            ], 1

    # Get frame dimensions from first frame
    first_image = Image.open(BytesIO(frames[0][1]))
    frame_width = first_image.width
    frame_height = first_image.height

    # Calculate batch sizes
    max_batch_size = calculate_max_batch_size(frame_width, frame_height, backend)
    even_batch_size = calculate_even_batch_size(len(frames), max_batch_size)

    # Process frames in batches
    all_results: list[OCRResult] = []
    failed_count = 0

    for batch_start in range(0, len(frames), even_batch_size):
        batch_end = min(batch_start + even_batch_size, len(frames))
        batch_frames = frames[batch_start:batch_end]

        try:
            # Create montage for this batch
            montage_bytes, metadata = create_vertical_montage(batch_frames)

            # Process montage with backend
            montage_result = backend.process_single(montage_bytes, language)

            # Distribute results back to individual images
            batch_results = distribute_results_to_images(montage_result, metadata)

            all_results.extend(batch_results)
        except Exception as e:
            print(f"[OCR] Failed to process batch {batch_start}-{batch_end}: {e}")
            # Create empty results for all frames in failed batch
            for frame_id, _ in batch_frames:
                all_results.append(
                    OCRResult(
                        id=frame_id,
                        characters=[],
                        text="",
                        char_count=0,
                    )
                )
            failed_count += len(batch_frames)

    return all_results, failed_count
