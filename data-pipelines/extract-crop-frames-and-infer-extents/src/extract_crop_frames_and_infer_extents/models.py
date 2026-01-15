"""
Data models for Modal function interfaces.
These are the contracts between Modal functions and Prefect flows.
"""

from dataclasses import dataclass


@dataclass
class CropRegion:
    """
    Normalized crop region coordinates (0.0 to 1.0).
    Defines the rectangular region to extract from video frames.
    """

    crop_left: float  # 0.0 = left edge, 1.0 = right edge
    crop_top: float  # 0.0 = top edge, 1.0 = bottom edge
    crop_right: float  # 0.0 = left edge, 1.0 = right edge
    crop_bottom: float  # 0.0 = top edge, 1.0 = bottom edge

    def __post_init__(self):
        """Validate crop region coordinates."""
        assert 0.0 <= self.crop_left < self.crop_right <= 1.0, (
            f"Invalid horizontal crop: {self.crop_left} to {self.crop_right}"
        )
        assert 0.0 <= self.crop_top < self.crop_bottom <= 1.0, (
            f"Invalid vertical crop: {self.crop_top} to {self.crop_bottom}"
        )


@dataclass
class ExtractResult:
    """
    Result from extract_frames_and_ocr Modal function.
    Initial video processing: frame extraction + OCR.
    """

    # Video metadata
    frame_count: int  # Total frames extracted
    duration: float  # Video duration in seconds
    frame_width: int  # Frame width in pixels
    frame_height: int  # Frame height in pixels
    video_codec: str  # Video codec (e.g., "h264", "vp9")
    bitrate: int  # Video bitrate in bits per second

    # OCR statistics
    ocr_box_count: int  # Total OCR text boxes detected across all frames
    failed_ocr_count: int  # Number of frames where OCR failed

    # Performance metrics
    processing_duration_seconds: float  # Total processing time

    # Wasabi storage keys (outputs uploaded to S3)
    full_frames_key: str  # Path to full_frames/ directory
    ocr_db_key: str  # Path to raw-ocr.db.gz (server-only)
    layout_db_key: str  # Path to layout.db.gz (client-accessible)


@dataclass
class CropInferResult:
    """
    Result from crop_and_infer_caption_frame_extents Modal function.
    Cropped frames + caption frame extents inference.
    """

    # Version tracking
    version: int  # Cropped frames version number (increments on crop region change)

    # Frame statistics
    frame_count: int  # Number of frames in cropped output

    # Inference statistics
    label_counts: dict[str, int]  # Count of each inferred label
    # Example: {"caption_start": 45, "caption_end": 42, "no_change": 1200}

    # Performance metrics
    processing_duration_seconds: float  # Total processing time

    # Wasabi storage keys (outputs uploaded to S3)
    caption_frame_extents_db_key: str  # Path to caption_frame_extents.db (server-only)
    cropped_frames_prefix: str  # Path prefix to cropped_frames_v{N}/ directory


@dataclass
class CaptionOcrResult:
    """
    Result from generate_caption_ocr Modal function.
    Median frame generation + OCR for a single caption.
    """

    # OCR output
    ocr_text: str  # Extracted text from median frame
    confidence: float  # OCR confidence score (0.0 to 1.0)

    # Processing metadata
    frame_count: int  # Number of frames used to generate median
    median_frame_index: int | None = None  # Index of the middle frame (for debugging)
