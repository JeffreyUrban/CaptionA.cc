"""Test utilities and helpers for E2E testing.

This module provides helper functions for creating test fixtures and mock data
used in end-to-end integration tests, particularly for testing video processing
pipelines and Modal function integrations.
"""

import subprocess
import tempfile
from pathlib import Path
from typing import Any


def create_test_video(
    duration: int,
    fps: int = 30,
    text_overlay: str | None = None,
    resolution: tuple[int, int] = (1920, 1080),
) -> Path:
    """Create a test video using FFmpeg.

    Generates a synthetic test video with the specified parameters. The video uses
    the testsrc pattern generator which creates a moving gradient test pattern.
    Optionally overlays text for debugging and visual verification.

    Args:
        duration: Video duration in seconds. Must be positive.
        fps: Frames per second for the output video. Typically 30 for standard
            video or 10 for processed caption videos. Must be positive.
        text_overlay: Optional text to overlay on the video. If provided, text
            will be centered horizontally and positioned near the bottom of the
            frame in white color with 48pt font.
        resolution: Video resolution as (width, height) tuple in pixels.
            Default is 1920x1080 (Full HD). Common alternatives:
            - (1280, 720) for 720p
            - (3840, 2160) for 4K

    Returns:
        Path to the created temporary video file (.mp4 format with H.264 codec).
        The file will be in the system's temporary directory and should be cleaned
        up by the caller when no longer needed.

    Raises:
        subprocess.CalledProcessError: If FFmpeg command fails (e.g., FFmpeg not
            installed, invalid parameters, or insufficient disk space).
        ValueError: If duration, fps, or resolution parameters are invalid.

    Example:
        >>> video_path = create_test_video(duration=10, fps=30, text_overlay="Test Video")
        >>> # Use video_path in tests
        >>> video_path.unlink()  # Clean up when done

    Notes:
        - Requires FFmpeg to be installed and available in PATH
        - Output uses H.264 codec with yuv420p pixel format for maximum compatibility
        - Generated files are temporary and should be cleaned up after use
        - The testsrc pattern provides a consistent, reproducible test input
    """
    if duration <= 0:
        raise ValueError(f"Duration must be positive, got {duration}")
    if fps <= 0:
        raise ValueError(f"FPS must be positive, got {fps}")
    if resolution[0] <= 0 or resolution[1] <= 0:
        raise ValueError(f"Resolution dimensions must be positive, got {resolution}")

    # Use NamedTemporaryFile instead of deprecated mktemp
    temp_file = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    output = Path(temp_file.name)
    temp_file.close()  # Close the file so FFmpeg can write to it

    # Base FFmpeg command - generate test pattern video
    cmd = [
        "ffmpeg",
        "-y",  # Overwrite output file if it exists
        "-f",
        "lavfi",
        "-i",
        f"testsrc=duration={duration}:size={resolution[0]}x{resolution[1]}:rate={fps}",
    ]

    # Add text overlay if specified
    if text_overlay:
        # Escape single quotes in text for shell safety
        safe_text = text_overlay.replace("'", "'\\''")
        cmd.extend(
            [
                "-vf",
                f"drawtext=text='{safe_text}':fontsize=48:x=(w-text_w)/2:y=h-th-20:fontcolor=white",
            ]
        )

    # Output settings - H.264 with yuv420p for maximum compatibility
    cmd.extend(
        [
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(output),
        ]
    )

    subprocess.run(cmd, check=True, capture_output=True)

    return output


def mock_modal_result(
    result_type: str = "extract",
    frame_count: int = 100,
    duration: float = 10.0,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create mock Modal function result.

    Generates mock result dictionaries that match the structure of actual Modal
    function returns. Useful for testing Prefect flows and API endpoints without
    requiring actual Modal function execution.

    Args:
        result_type: Type of Modal result to create. Supported values:
            - "extract": ExtractResult (from extract_frames_and_ocr)
            - "crop_infer": CropInferResult (from crop_and_infer_caption_frame_extents)
            - "caption_ocr": CaptionOcrResult (from generate_caption_ocr)
        frame_count: Number of frames in the video/result. Must be positive.
        duration: Video duration in seconds (for extract results only).
        **kwargs: Additional fields to override defaults or add custom fields.
            Common overrides:
            - frame_width: Video frame width (default: 1920)
            - frame_height: Video frame height (default: 1080)
            - video_codec: Video codec string (default: "h264")
            - bitrate: Video bitrate in bps (default: 5000000)
            - ocr_box_count: Total OCR boxes detected (default: 50)
            - failed_ocr_count: Failed OCR attempts (default: 0)
            - processing_duration_seconds: Processing time (default: 45.0)
            - full_frames_key: Wasabi key for full frames (default: "tenant/videos/frames/")
            - ocr_db_key: Wasabi key for OCR database (default: "tenant/videos/ocr.db.gz")
            - layout_db_key: Wasabi key for layout database (default: "tenant/videos/layout.db.gz")
            - version: Cropped frames version number (default: 1)
            - label_counts: Label distribution dict (default: {"caption_start": 10, ...})
            - caption_frame_extents_db_key: Wasabi key (default: "tenant/videos/extents.db")
            - cropped_frames_prefix: Wasabi prefix (default: "tenant/videos/cropped_v1/")
            - ocr_text: OCR text string (default: "Sample caption text")
            - confidence: OCR confidence score (default: 0.95)
            - median_frame_index: Frame index used (default: frame_count // 2)

    Returns:
        Dictionary matching the structure of the specified Modal result type.

    Raises:
        ValueError: If result_type is not one of the supported types.

    Example:
        >>> # Mock extract result with custom dimensions
        >>> result = mock_modal_result(
        ...     result_type="extract",
        ...     frame_count=500,
        ...     duration=50.0,
        ...     frame_width=1280,
        ...     frame_height=720
        ... )
        >>> result["frame_count"]
        500
        >>> result["frame_width"]
        1280

        >>> # Mock crop_infer result with custom labels
        >>> result = mock_modal_result(
        ...     result_type="crop_infer",
        ...     frame_count=300,
        ...     version=2,
        ...     label_counts={"caption_start": 15, "caption_end": 15, "no_change": 270}
        ... )

        >>> # Mock caption OCR result
        >>> result = mock_modal_result(
        ...     result_type="caption_ocr",
        ...     frame_count=10,
        ...     ocr_text="Test caption",
        ...     confidence=0.98
        ... )

    Notes:
        - Result structures match data-pipelines/extract-crop-frames-and-infer-extents/src/extract_crop_frames_and_infer_extents/models.py
        - Default values are reasonable for typical test scenarios
        - All Wasabi keys and prefixes use placeholder paths (update as needed)
        - ExtractResult is the most common result type for initial video processing
    """
    if result_type == "extract":
        return _mock_extract_result(frame_count, duration, **kwargs)
    elif result_type == "crop_infer":
        return _mock_crop_infer_result(frame_count, **kwargs)
    elif result_type == "caption_ocr":
        return _mock_caption_ocr_result(frame_count, **kwargs)
    else:
        raise ValueError(
            f"Invalid result_type: {result_type}. "
            f"Must be one of: extract, crop_infer, caption_ocr"
        )


def _mock_extract_result(
    frame_count: int,
    duration: float,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create mock ExtractResult from extract_frames_and_ocr.

    Internal helper for mock_modal_result().

    Args:
        frame_count: Number of frames extracted
        duration: Video duration in seconds
        **kwargs: Field overrides

    Returns:
        Dictionary matching ExtractResult structure
    """
    return {
        # Video metadata
        "frame_count": frame_count,
        "duration": duration,
        "frame_width": kwargs.get("frame_width", 1920),
        "frame_height": kwargs.get("frame_height", 1080),
        "video_codec": kwargs.get("video_codec", "h264"),
        "bitrate": kwargs.get("bitrate", 5_000_000),
        # OCR statistics
        "ocr_box_count": kwargs.get("ocr_box_count", 50),
        "failed_ocr_count": kwargs.get("failed_ocr_count", 0),
        # Performance metrics
        "processing_duration_seconds": kwargs.get("processing_duration_seconds", 45.0),
        # Wasabi storage keys
        "full_frames_key": kwargs.get("full_frames_key", "tenant/videos/frames/"),
        "ocr_db_key": kwargs.get("ocr_db_key", "tenant/videos/ocr.db.gz"),
        "layout_db_key": kwargs.get("layout_db_key", "tenant/videos/layout.db.gz"),
    }


def _mock_crop_infer_result(
    frame_count: int,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create mock CropInferResult from crop_and_infer_caption_frame_extents.

    Internal helper for mock_modal_result().

    Args:
        frame_count: Number of cropped frames
        **kwargs: Field overrides

    Returns:
        Dictionary matching CropInferResult structure
    """
    # Default label distribution: ~10% starts, ~10% ends, ~80% no_change
    default_label_counts = {
        "caption_start": frame_count // 10,
        "caption_end": frame_count // 10,
        "no_change": frame_count - (2 * (frame_count // 10)),
    }

    version = kwargs.get("version", 1)

    return {
        # Version tracking
        "version": version,
        # Frame statistics
        "frame_count": frame_count,
        # Inference statistics
        "label_counts": kwargs.get("label_counts", default_label_counts),
        # Performance metrics
        "processing_duration_seconds": kwargs.get("processing_duration_seconds", 30.0),
        # Wasabi storage keys
        "caption_frame_extents_db_key": kwargs.get(
            "caption_frame_extents_db_key",
            "tenant/videos/extents.db",
        ),
        "cropped_frames_prefix": kwargs.get(
            "cropped_frames_prefix",
            f"tenant/videos/cropped_v{version}/",
        ),
    }


def _mock_caption_ocr_result(
    frame_count: int,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create mock CaptionOcrResult from generate_caption_ocr.

    Internal helper for mock_modal_result().

    Args:
        frame_count: Number of frames used to generate median
        **kwargs: Field overrides

    Returns:
        Dictionary matching CaptionOcrResult structure
    """
    return {
        # OCR output
        "ocr_text": kwargs.get("ocr_text", "Sample caption text"),
        "confidence": kwargs.get("confidence", 0.95),
        # Processing metadata
        "frame_count": frame_count,
        "median_frame_index": kwargs.get("median_frame_index", frame_count // 2),
    }


def cleanup_test_video(video_path: Path) -> None:
    """Clean up a test video file.

    Helper function to safely remove test video files created by create_test_video().
    Handles the case where the file may already be deleted or doesn't exist.

    Args:
        video_path: Path to the video file to remove

    Example:
        >>> video = create_test_video(duration=5)
        >>> # ... use video in tests ...
        >>> cleanup_test_video(video)

    Notes:
        - Silently ignores FileNotFoundError if file doesn't exist
        - Other errors (permissions, etc.) will be raised
    """
    try:
        video_path.unlink()
    except FileNotFoundError:
        pass


def create_mock_wasabi_keys(
    tenant_id: str,
    video_id: str,
    version: int | None = None,
) -> dict[str, str]:
    """Generate consistent Wasabi storage keys for testing.

    Creates a complete set of Wasabi S3 keys following the project's naming
    conventions. Useful for creating mock data and verifying key formats.

    Args:
        tenant_id: Tenant UUID
        video_id: Video UUID
        version: Optional version number for cropped frames. If provided, includes
            cropped_frames_prefix key.

    Returns:
        Dictionary with keys:
        - full_frames_key: Path to full frames directory
        - ocr_db_key: Path to OCR database (gzipped)
        - layout_db_key: Path to layout database (gzipped)
        - caption_frame_extents_db_key: Path to caption frame extents database
        - cropped_frames_prefix: Path prefix for cropped frames (only if version provided)

    Example:
        >>> keys = create_mock_wasabi_keys("tenant-123", "video-456", version=1)
        >>> keys["full_frames_key"]
        'tenant-123/videos/video-456/full_frames/'
        >>> keys["cropped_frames_prefix"]
        'tenant-123/videos/video-456/cropped_frames_v1/'

    Notes:
        - Keys follow the pattern: {tenant_id}/videos/{video_id}/{resource}
        - Database files use .db.gz extension
        - Frame directories use trailing slash
        - Version numbers are zero-padded if needed
    """
    base_prefix = f"{tenant_id}/videos/{video_id}"

    keys = {
        "full_frames_key": f"{base_prefix}/full_frames/",
        "ocr_db_key": f"{base_prefix}/raw-ocr.db.gz",
        "layout_db_key": f"{base_prefix}/layout.db.gz",
        "caption_frame_extents_db_key": f"{base_prefix}/caption_frame_extents.db",
    }

    if version is not None:
        keys["cropped_frames_prefix"] = f"{base_prefix}/cropped_frames_v{version}/"

    return keys


def validate_modal_result(result: dict[str, Any], result_type: str) -> bool:
    """Validate that a result dictionary has all required fields.

    Checks that a Modal function result (real or mock) contains all required
    fields for its type. Useful for validating test data and ensuring mocks
    match actual result structures.

    Args:
        result: Result dictionary to validate
        result_type: Expected result type ("extract", "crop_infer", or "caption_ocr")

    Returns:
        True if all required fields are present, False otherwise

    Example:
        >>> result = mock_modal_result("extract", frame_count=100)
        >>> validate_modal_result(result, "extract")
        True
        >>> incomplete_result = {"frame_count": 100}
        >>> validate_modal_result(incomplete_result, "extract")
        False

    Notes:
        - Only checks for presence of required fields, not their types or values
        - Follows data models in data-pipelines/extract-crop-frames-and-infer-extents/src/extract_crop_frames_and_infer_extents/models.py
    """
    if result_type == "extract":
        required_fields = {
            "frame_count",
            "duration",
            "frame_width",
            "frame_height",
            "video_codec",
            "bitrate",
            "ocr_box_count",
            "failed_ocr_count",
            "processing_duration_seconds",
            "full_frames_key",
            "ocr_db_key",
            "layout_db_key",
        }
    elif result_type == "crop_infer":
        required_fields = {
            "version",
            "frame_count",
            "label_counts",
            "processing_duration_seconds",
            "caption_frame_extents_db_key",
            "cropped_frames_prefix",
        }
    elif result_type == "caption_ocr":
        required_fields = {
            "ocr_text",
            "confidence",
            "frame_count",
        }
    else:
        raise ValueError(f"Invalid result_type: {result_type}")

    return required_fields.issubset(result.keys())
