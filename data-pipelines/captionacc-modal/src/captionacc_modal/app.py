"""
Modal App for CaptionA.cc GPU Functions

This module defines the Modal app and registers all GPU-intensive functions:
1. extract_frames_and_ocr - Frame extraction and OCR (T4 GPU)
2. crop_and_infer_caption_frame_extents - Cropping and inference (A10G GPU)
3. generate_caption_ocr - Median frame OCR (T4 GPU)
"""

try:
    import modal
except ImportError:
    modal = None  # Optional dependency

from .models import CaptionOcrResult, CropInferResult, CropRegion, ExtractResult

# Create Modal app
if modal:
    app = modal.App("captionacc-processing")

    # Import image builders and implementations
    from .inference import get_inference_image
    from .inference_pipelined import crop_and_infer_caption_frame_extents_pipelined
    from .inference_sequential import crop_and_infer_caption_frame_extents_sequential
    from .extract import extract_frames_and_ocr_impl

    # Base image with common dependencies
    base_image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install(
            "opencv-python-headless",
            "numpy",
            "pillow",
            "boto3",
            "google-cloud-vision",
            "ffmpeg-python",
        )
        .apt_install("libgl1-mesa-glx", "libglib2.0-0", "ffmpeg")
    )

    @app.function(
        image=base_image,
        gpu="T4",
        timeout=300,  # 5 minutes
        retries=1,
        secrets=[
            modal.Secret.from_name("wasabi"),
            modal.Secret.from_name("google-vision"),
        ],
    )
    def generate_caption_ocr(
        chunks_prefix: str,
        start_frame: int,
        end_frame: int,
    ) -> CaptionOcrResult:
        """Generate median frame from range and run OCR.

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
        from .ocr import generate_caption_ocr as _generate_caption_ocr

        return _generate_caption_ocr(chunks_prefix, start_frame, end_frame)


    @app.function(
        image=base_image,
        gpu="T4",
        timeout=1800,  # 30 minutes
        retries=0,
        secrets=[
            modal.Secret.from_name("wasabi"),
            modal.Secret.from_name("google-vision"),
        ],
    )
    def extract_frames_and_ocr(
        video_key: str,
        tenant_id: str,
        video_id: str,
        frame_rate: float = 0.1,
    ) -> ExtractResult:
        """Extract frames from video and run OCR on each frame.

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
        return extract_frames_and_ocr_impl(video_key, tenant_id, video_id, frame_rate)

    # Register crop_and_infer_caption_frame_extents function
    # Mount model volume
    model_volume = modal.Volume.from_name("boundary-models", create_if_missing=False)

    @app.function(
        image=get_inference_image(),
        gpu="A10G",
        timeout=3600,  # 60 minutes
        retries=0,
        secrets=[modal.Secret.from_name("wasabi")],
        volumes={"/root/boundary-models": model_volume},
    )
    def crop_and_infer_caption_frame_extents(
        video_key: str,
        tenant_id: str,
        video_id: str,
        crop_region: CropRegion,
        frame_rate: float = 10.0,
        encoder_workers: int = 4,
        inference_batch_size: int = 32,
    ) -> CropInferResult:
        """Crop frames to caption region, encode as WebM, and run inference.

        Uses pipelined implementation with GPU-accelerated extraction and parallel encoding.
        See inference_pipelined.py for full implementation details.

        Args:
            encoder_workers: Number of parallel VP9 encoding workers (default: 4)
            inference_batch_size: Number of images per inference batch (default: 32)
        """
        return crop_and_infer_caption_frame_extents_pipelined(
            video_key, tenant_id, video_id, crop_region, frame_rate, encoder_workers, inference_batch_size
        )

    @app.function(
        image=get_inference_image(),
        gpu="A10G",
        timeout=3600,  # 60 minutes
        retries=0,
        secrets=[modal.Secret.from_name("wasabi")],
        volumes={"/root/boundary-models": model_volume},
    )
    def crop_and_infer_sequential(
        video_key: str,
        tenant_id: str,
        video_id: str,
        crop_region: CropRegion,
        frame_rate: float = 10.0,
        encoder_workers: int = 4,
        max_frames: int = 5000,
    ) -> CropInferResult:
        """Sequential (non-pipelined) implementation for performance profiling.

        Runs each stage sequentially with detailed timing and monitoring.
        Limited to first max_frames for faster iteration.

        Args:
            max_frames: Maximum number of frames to process (default: 5000)
        """
        return crop_and_infer_caption_frame_extents_sequential(
            video_key, tenant_id, video_id, crop_region, frame_rate, encoder_workers, max_frames
        )

else:
    # Modal not available - provide stubs for type checking
    def generate_caption_ocr(
        chunks_prefix: str,
        start_frame: int,
        end_frame: int,
    ) -> CaptionOcrResult:
        raise RuntimeError("Modal not installed")

    def extract_frames_and_ocr(
        video_key: str,
        tenant_id: str,
        video_id: str,
        frame_rate: float = 0.1,
    ) -> ExtractResult:
        raise RuntimeError("Modal not installed")

    def crop_and_infer_caption_frame_extents(
        video_key: str,
        tenant_id: str,
        video_id: str,
        crop_region: CropRegion,
        frame_rate: float = 10.0,
    ) -> CropInferResult:
        raise RuntimeError("Modal not installed")
