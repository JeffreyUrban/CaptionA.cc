"""
Modal App for Extract, Crop, and Infer Extents

This module defines the Modal app and registers GPU-intensive functions:
- crop_and_infer_caption_frame_extents - Cropping and inference (A10G GPU)
"""

try:
    import modal
except ImportError:
    modal = None  # Optional dependency

from .models import CropInferResult, CropRegion

# Create Modal app
if modal:
    app = modal.App("extract-crop-frames-and-infer-extents")

    # Import image builders and implementations
    from .inference import get_inference_image
    from .pipeline import crop_and_infer_caption_frame_extents_pipelined

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
    def extract_crop_frames_and_infer_extents(
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
        See pipeline.py for full implementation details.

        Args:
            encoder_workers: Number of parallel VP9 encoding workers (default: 4)
            inference_batch_size: Number of images per inference batch (default: 32)
        """
        return crop_and_infer_caption_frame_extents_pipelined(
            video_key, tenant_id, video_id, crop_region, frame_rate, encoder_workers, inference_batch_size
        )

else:
    # Modal not available - provide stubs for type checking
    app = None

    def extract_crop_frames_and_infer_extents(
        _video_key: str,
        _tenant_id: str,
        _video_id: str,
        _crop_region: CropRegion,
        _frame_rate: float = 10.0,
        _encoder_workers: int = 4,
        _inference_batch_size: int = 32,
    ) -> CropInferResult:
        raise RuntimeError("Modal not installed")
