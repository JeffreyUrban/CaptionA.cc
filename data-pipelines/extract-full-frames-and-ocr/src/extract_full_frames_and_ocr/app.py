"""Modal App for Full Frames GPU + OCR Processing.

This module defines the Modal app and registers the GPU-accelerated
full frame extraction and OCR function.
"""

import os

try:
    import modal
except ImportError:
    modal = None

# Create Modal app with namespace suffix (e.g., "dev" or "prod")
# Set modal_app_suffix environment variable during deployment
if modal:
    app_suffix = os.environ.get("modal_app_suffix", "prod")
    app = modal.App(f"extract-full-frames-and-ocr-{app_suffix}")

    # Import image builder only (not implementation - that has heavy dependencies)
    from .modal_inference import get_full_frames_image

    @app.function(
        image=get_full_frames_image(),
        gpu="A10G",
        timeout=1800,  # 30 minutes
        retries=0,
        secrets=[
            modal.Secret.from_name("wasabi"),
            modal.Secret.from_name("google-vision"),
        ],
    )
    def extract_full_frames_and_ocr(
        video_key: str,
        tenant_id: str,
        video_id: str,
        rate_hz: float = 0.1,
        language: str = "zh-Hans",
    ) -> dict:
        """Extract frames with GPU and process with OCR service.

        Args:
            video_key: Wasabi S3 key for video file
                      Example: "tenant-123/client/videos/video-456/video.mp4"
            tenant_id: Tenant UUID for path scoping
            video_id: Video UUID
            rate_hz: Frame extraction rate in Hz (default: 0.1 = 1 frame per 10s)
            language: OCR language hint (default: "zh-Hans")

        Returns:
            Dict with version, frame_count, total_ocr_boxes, processing_duration_seconds,
            fullOCR_db_key, and full_frames_prefix

        Raises:
            ValueError: Invalid parameters
            RuntimeError: Processing error

        Wasabi Outputs:
            - {tenant_id}/client/videos/{video_id}/full_frames/frame_NNNNNNNNNN.jpg
            - {tenant_id}/server/videos/{video_id}/fullOCR.db
        """
        # Import inside function to avoid heavy dependencies during deployment
        from .modal_inference import extract_frames_and_ocr_impl

        return extract_frames_and_ocr_impl(
            video_key, tenant_id, video_id, rate_hz, language
        )

else:
    # Modal not available - provide stub for type checking
    def extract_full_frames_and_ocr(
        video_key: str,
        tenant_id: str,
        video_id: str,
        rate_hz: float = 0.1,
        language: str = "zh-Hans",
    ) -> dict:
        raise RuntimeError("Modal not installed")
