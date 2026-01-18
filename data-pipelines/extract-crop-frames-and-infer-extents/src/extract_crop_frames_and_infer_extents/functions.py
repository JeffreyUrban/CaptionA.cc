"""
Modal function interfaces - these are the contracts.
Implementations must match these exact signatures.

Error Handling Strategy:
    All Modal functions use a fail-fast approach. If processing fails partway through,
    the function raises an exception rather than returning partial results.

    Rationale:
    - Simpler error handling in orchestration flows
    - No partial/incomplete data in Wasabi
    - Clear failure signals for retry logic
    - Most processing errors are transient (retries usually succeed)

    Future Enhancement:
    Consider returning partial results for more resilient processing:
    - Add `partial: bool` field to result dataclasses
    - Add `errors: list[str]` field for per-frame/per-operation failures
    - Allow flows to accept partial results when appropriate
    - Useful when 95% of processing succeeds but 5% fails (e.g., OCR on a few frames)

    For now, implementations should raise exceptions on any significant failure.
"""

from typing import Protocol

from .models import CaptionOcrResult, CropInferResult, CropRegion, ExtractResult


class ExtractFramesAndOcr(Protocol):
    """
    Extract frames from video and run OCR on each frame.

    GPU: T4
    Timeout: 30 minutes (1800 seconds)
    Retries: 0 (orchestration layer handles retries)
    """

    def __call__(
        self,
        video_key: str,
        tenant_id: str,
        video_id: str,
        frame_rate: float = 0.1,
    ) -> ExtractResult:
        """
        Extract frames from video at low frequency and run OCR.

        Args:
            video_key: Wasabi S3 key for video file
                      Example: "tenant-123/client/videos/video-456/video.mp4"
            tenant_id: Tenant UUID for path scoping
            video_id: Video UUID
            frame_rate: Frames per second to extract (default: 0.1 = 1 frame per 10 seconds)

        Returns:
            ExtractResult with frame count, duration, OCR stats, and S3 paths

        Raises:
            ValueError: Invalid parameters
            RuntimeError: Processing error (FFmpeg, OCR, etc.)

        Wasabi Outputs:
            - {tenant_id}/client/videos/{video_id}/full_frames/frame_{NNNNNN}.jpg
            - {tenant_id}/server/videos/{video_id}/raw-ocr.db.gz
            - {tenant_id}/client/videos/{video_id}/layout.db.gz
        """
        ...


class CropAndInferCaptionFrameExtents(Protocol):
    """
    Crop frames to caption region and run caption frame extents inference.

    GPU: A10G
    Timeout: 60 minutes (3600 seconds)
    Retries: 0 (orchestration layer handles retries)
    """

    def __call__(
        self,
        video_key: str,
        tenant_id: str,
        video_id: str,
        crop_region: CropRegion,
        frame_rate: float = 10.0,
    ) -> CropInferResult:
        """
        Crop frames to caption region, encode as WebM, and run inference.

        Args:
            video_key: Wasabi S3 key for video file
            tenant_id: Tenant UUID for path scoping
            video_id: Video UUID
            crop_region: Normalized crop region (0.0 to 1.0)
            frame_rate: Frames per second to extract (default: 10.0)

        Returns:
            CropInferResult with version, frame count, inference stats, and S3 paths

        Raises:
            ValueError: Invalid crop region or parameters
            RuntimeError: Processing error (FFmpeg, inference, etc.)

        Wasabi Outputs:
            - {tenant_id}/client/videos/{video_id}/cropped_frames_v{N}/modulo_{M}/chunk_{NNNN}.webm
            - {tenant_id}/server/videos/{video_id}/caption_frame_extents.db.gz
        """
        ...


class GenerateCaptionOcr(Protocol):
    """
    Generate median frame from range and run OCR.

    GPU: T4
    Timeout: 5 minutes (300 seconds)
    Retries: 1 (lightweight operation)
    """

    def __call__(
        self,
        chunks_prefix: str,
        start_frame: int,
        end_frame: int,
    ) -> CaptionOcrResult:
        """
        Generate median frame from frame range and run OCR.

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

        Notes:
            - Downloads only needed WebM chunks (not entire video)
            - Computes per-pixel median to reduce noise
            - No Wasabi uploads (result returned directly)
        """
        ...


# Type aliases for convenience
ExtractFramesAndOcrFunc = ExtractFramesAndOcr
CropAndInferCaptionFrameExtentsFunc = CropAndInferCaptionFrameExtents
GenerateCaptionOcrFunc = GenerateCaptionOcr
