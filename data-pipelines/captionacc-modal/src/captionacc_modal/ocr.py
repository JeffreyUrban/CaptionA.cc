"""
OCR processing for caption median frames.

This module generates median frames from WebM chunks and runs Google Vision OCR.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

try:
    import cv2
    import numpy as np
    from google.cloud import vision
except ImportError:
    # These are only available in Modal environment
    cv2 = None  # type: ignore
    np = None  # type: ignore
    vision = None  # type: ignore

if TYPE_CHECKING:
    import numpy as np

from .models import CaptionOcrResult


def determine_modulo_for_frame(frame_index: int) -> int:
    """Determine which modulo level contains this frame.

    Args:
        frame_index: Absolute frame index

    Returns:
        Modulo level (1, 4, or 16)
    """
    if frame_index % 16 == 0:
        return 16
    elif frame_index % 4 == 0:
        return 4
    else:
        return 1


def get_frames_in_chunk(chunk_start_frame: int, modulo: int, frames_per_chunk: int = 32) -> list[int]:
    """Get the list of frame indices contained in a chunk.

    Args:
        chunk_start_frame: The first frame index in the chunk
        modulo: The modulo level (16, 4, or 1)
        frames_per_chunk: Number of frames per chunk (default 32)

    Returns:
        List of frame indices in this chunk
    """
    frames = []
    i = chunk_start_frame

    if modulo == 16:
        # modulo_16: every 16th frame
        while len(frames) < frames_per_chunk:
            frames.append(i)
            i += 16
    elif modulo == 4:
        # modulo_4: every 4th frame that's NOT divisible by 16
        while len(frames) < frames_per_chunk:
            if i % 16 != 0:
                frames.append(i)
            i += 4
    else:  # modulo == 1
        # modulo_1: every frame that's NOT divisible by 4
        while len(frames) < frames_per_chunk:
            if i % 4 != 0:
                frames.append(i)
            i += 1

    return frames


def download_chunk_from_wasabi(storage_key: str, local_path: Path) -> None:
    """Download WebM chunk from Wasabi S3.

    Args:
        storage_key: S3 key for the chunk
        local_path: Local path to save chunk

    Raises:
        RuntimeError: If download fails
    """
    import boto3
    from botocore.client import Config

    # Get credentials from environment (injected by Modal secrets)
    access_key = os.environ.get("WASABI_ACCESS_KEY_READWRITE") or os.environ.get("WASABI_ACCESS_KEY")
    secret_key = os.environ.get("WASABI_SECRET_KEY_READWRITE") or os.environ.get("WASABI_SECRET_KEY")

    if not access_key or not secret_key:
        raise RuntimeError("Wasabi credentials not found in environment")

    # Initialize S3 client
    s3_client = boto3.client(
        "s3",
        endpoint_url="https://s3.us-east-1.wasabisys.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
    )

    # Download chunk
    try:
        s3_client.download_file(
            "caption-acc-prod",
            storage_key,
            str(local_path),
        )
    except Exception as e:
        raise RuntimeError(f"Failed to download chunk from {storage_key}: {e}") from e


def extract_frames_from_chunk(chunk_path: Path, chunk_start_frame: int, modulo: int) -> dict[int, np.ndarray]:
    """Extract all frames from a WebM chunk.

    Args:
        chunk_path: Path to WebM chunk file
        chunk_start_frame: First frame index in chunk
        modulo: Modulo level (1, 4, or 16)

    Returns:
        Dict mapping frame_index -> frame (RGB numpy array)

    Raises:
        RuntimeError: If extraction fails
    """
    # Get frame indices in this chunk
    frame_indices = get_frames_in_chunk(chunk_start_frame, modulo)

    # Open video
    cap = cv2.VideoCapture(str(chunk_path))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video file: {chunk_path}")

    frames = {}
    for position, frame_idx in enumerate(frame_indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, position)
        ret, frame = cap.read()
        if ret and frame is not None:
            # Convert BGR to RGB
            frames[frame_idx] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    cap.release()
    return frames


def compute_median_frame(frames: list[np.ndarray]) -> np.ndarray:
    """Compute per-pixel median across frames.

    Args:
        frames: List of frames as numpy arrays

    Returns:
        Median frame as numpy array (uint8)

    Raises:
        ValueError: If frames list is empty
    """
    if not frames:
        raise ValueError("Cannot compute median from empty frames list")

    # Stack frames and compute median
    frames_array = np.array(frames)
    median_frame = np.median(frames_array, axis=0).astype(np.uint8)

    return median_frame


def run_google_vision_ocr(image: np.ndarray) -> tuple[str, float]:
    """Run Google Vision OCR on an image.

    Args:
        image: Image as numpy array (RGB, uint8)

    Returns:
        Tuple of (extracted_text, confidence)

    Raises:
        RuntimeError: If OCR fails
    """
    # Convert numpy array to JPEG bytes
    import cv2
    from io import BytesIO
    from PIL import Image

    # Convert to PIL Image
    pil_image = Image.fromarray(image)

    # Encode as JPEG
    buffer = BytesIO()
    pil_image.save(buffer, format="JPEG", quality=95)
    image_bytes = buffer.getvalue()

    # Call Google Vision API
    try:
        client = vision.ImageAnnotatorClient()
        vision_image = vision.Image(content=image_bytes)

        response = client.document_text_detection(
            image=vision_image,
            image_context={"language_hints": ["zh"]}
        )

        if response.error.message:
            raise RuntimeError(f"Google Vision API error: {response.error.message}")

        # Extract full text
        if response.full_text_annotation:
            text = response.full_text_annotation.text
            # Calculate average confidence from pages
            total_confidence = 0.0
            total_blocks = 0

            for page in response.full_text_annotation.pages:
                for block in page.blocks:
                    total_confidence += block.confidence
                    total_blocks += 1

            confidence = total_confidence / total_blocks if total_blocks > 0 else 0.0

            return text.strip(), confidence
        else:
            # No text detected
            return "", 0.0

    except Exception as e:
        raise RuntimeError(f"OCR processing failed: {e}") from e


def generate_caption_ocr(
    chunks_prefix: str,
    start_frame: int,
    end_frame: int,
) -> CaptionOcrResult:
    """Generate median frame from range and run OCR.

    This is the main implementation of the Modal function.

    Args:
        chunks_prefix: Wasabi S3 prefix for cropped frames
                      Example: "tenant-123/client/videos/video-456/cropped_frames_v1/"
        start_frame: Start frame index (inclusive)
        end_frame: End frame index (exclusive)

    Returns:
        CaptionOcrResult with OCR text, confidence, and frame count

    Raises:
        ValueError: Invalid frame range
        RuntimeError: OCR processing error
    """
    # Validate frame range
    if start_frame < 0:
        raise ValueError(f"start_frame must be >= 0, got {start_frame}")
    if end_frame <= start_frame:
        raise ValueError(f"end_frame ({end_frame}) must be > start_frame ({start_frame})")

    # Determine which chunks we need to download
    frame_indices = list(range(start_frame, end_frame))

    # Group frames by chunk
    chunks_needed: dict[tuple[int, int, int], list[int]] = {}  # (chunk_start, chunk_index, modulo) -> [frame_indices]

    for frame_idx in frame_indices:
        modulo = determine_modulo_for_frame(frame_idx)
        chunk_size = 32 * modulo  # 32 frames per chunk, spaced by modulo
        chunk_start = (frame_idx // chunk_size) * chunk_size
        chunk_index = chunk_start // modulo  # Chunk number within modulo level

        key = (chunk_start, chunk_index, modulo)
        if key not in chunks_needed:
            chunks_needed[key] = []
        chunks_needed[key].append(frame_idx)

    print(f"[OCR] Processing frames {start_frame} to {end_frame} ({len(frame_indices)} frames)")
    print(f"[OCR] Need to download {len(chunks_needed)} chunks")

    # Download chunks and extract frames
    all_frames: dict[int, np.ndarray] = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        for (chunk_start, chunk_index, modulo), frame_list in chunks_needed.items():
            # Build storage key for this chunk
            # Format: {prefix}/modulo_{modulo}/chunk_{index:04d}.webm
            storage_key = f"{chunks_prefix}modulo_{modulo}/chunk_{chunk_index:04d}.webm"
            chunk_path = temp_path / f"chunk_{chunk_index}_{modulo}.webm"

            print(f"[OCR] Downloading chunk: {storage_key}")

            try:
                download_chunk_from_wasabi(storage_key, chunk_path)
            except RuntimeError as e:
                raise RuntimeError(f"Failed to download chunk {storage_key}: {e}") from e

            # Extract frames from this chunk
            try:
                chunk_frames = extract_frames_from_chunk(chunk_path, chunk_start, modulo)
            except RuntimeError as e:
                raise RuntimeError(f"Failed to extract frames from chunk {storage_key}: {e}") from e

            # Keep only frames in our range
            for frame_idx in frame_list:
                if frame_idx in chunk_frames:
                    all_frames[frame_idx] = chunk_frames[frame_idx]

            print(f"[OCR] Extracted {len([f for f in frame_list if f in chunk_frames])} frames from chunk")

    # Verify we got all frames
    if len(all_frames) != len(frame_indices):
        missing = set(frame_indices) - set(all_frames.keys())
        raise RuntimeError(f"Missing {len(missing)} frames: {sorted(list(missing))[:10]}...")

    print(f"[OCR] Successfully extracted {len(all_frames)} frames")

    # Compute median frame
    frames_list = [all_frames[idx] for idx in sorted(all_frames.keys())]
    median_frame = compute_median_frame(frames_list)

    print(f"[OCR] Computed median frame")

    # Run OCR on median frame
    try:
        ocr_text, confidence = run_google_vision_ocr(median_frame)
    except RuntimeError as e:
        raise RuntimeError(f"OCR failed: {e}") from e

    print(f"[OCR] OCR complete: {len(ocr_text)} characters, confidence {confidence:.2f}")

    # Calculate median frame index (for debugging)
    median_frame_index = frame_indices[len(frame_indices) // 2]

    return CaptionOcrResult(
        ocr_text=ocr_text,
        confidence=confidence,
        frame_count=len(frame_indices),
        median_frame_index=median_frame_index,
    )
