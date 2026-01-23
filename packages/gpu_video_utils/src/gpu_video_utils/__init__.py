"""GPU-accelerated video processing utilities.

This package provides video decoding with automatic hardware acceleration
based on the available platform:

- NVIDIA GPUs (Modal/cloud): NVDECDecoder using PyNvVideoCodec
- Apple Silicon (local dev): VideoToolboxDecoder using PyAV + VideoToolbox
- Fallback: SoftwareDecoder using PyAV CPU decoding

Usage:
    from gpu_video_utils import get_decoder

    # Auto-select decoder based on environment
    decoder = get_decoder("video.mp4")
    info = decoder.get_video_info()
    frame = decoder.get_frame_at_index(100)
    decoder.close()

    # Or explicitly specify a decoder type
    decoder = get_decoder("video.mp4", decoder_type="videotoolbox")

Environment variables:
    VIDEO_DECODER: Override decoder selection ('nvdec', 'videotoolbox', 'software')
    ENVIRONMENT: Used if VIDEO_DECODER not set (local -> videotoolbox, else nvdec)
"""

import os
import platform
from pathlib import Path

from .base import BaseVideoDecoder, DecodeError, ResourceError, VideoDecoder, VideoDecoderError

# Optional decoder imports - availability depends on platform/dependencies
NVDECDecoder = None
VideoToolboxDecoder = None
SoftwareDecoder = None

try:
    from .nvdec_decoder import NVDECDecoder, GPUVideoDecoder
except ImportError:
    GPUVideoDecoder = None  # type: ignore

try:
    from .videotoolbox_decoder import VideoToolboxDecoder, VIDEOTOOLBOX_AVAILABLE
except ImportError:
    VIDEOTOOLBOX_AVAILABLE = False

try:
    from .software_decoder import SoftwareDecoder, PYAV_AVAILABLE
except ImportError:
    PYAV_AVAILABLE = False

# Frame extraction functions
from .frame_extraction import extract_frames_for_montage, extract_frames_gpu

# Montage functions
from .gpu_montage import (
    MontageValidationError,
    create_vertical_montage_cpu,
    create_vertical_montage_from_pil,
    create_vertical_montage_gpu,
)
from .montage import calculate_montage_capacity


def get_decoder(
    video_path: Path | str,
    decoder_type: str | None = None,
    **kwargs,
) -> BaseVideoDecoder:
    """Get a video decoder instance based on environment or explicit type.

    Decoder selection priority:
    1. Explicit decoder_type parameter
    2. VIDEO_DECODER environment variable
    3. ENVIRONMENT variable:
       - 'local' on macOS -> VideoToolboxDecoder
       - 'local' on other platforms -> SoftwareDecoder
       - else -> NVDECDecoder (for Modal/cloud)

    Args:
        video_path: Path to the video file
        decoder_type: Optional explicit decoder type:
            - 'nvdec': NVIDIA NVDEC (requires NVIDIA GPU)
            - 'videotoolbox': Apple VideoToolbox (requires macOS)
            - 'software': CPU-based PyAV decoding
        **kwargs: Additional arguments passed to the decoder constructor

    Returns:
        Instantiated video decoder

    Raises:
        ValueError: If requested decoder is not available
        FileNotFoundError: If video file doesn't exist
    """
    video_path = Path(video_path)

    # Determine which decoder to use
    if decoder_type is None:
        decoder_type = os.environ.get("VIDEO_DECODER")

    if decoder_type is None:
        environment = os.environ.get("ENVIRONMENT", "").lower()
        if environment == "local":
            # Local development - use platform-appropriate decoder
            if platform.system() == "Darwin" and VIDEOTOOLBOX_AVAILABLE:
                decoder_type = "videotoolbox"
            elif PYAV_AVAILABLE:
                decoder_type = "software"
            else:
                raise ValueError(
                    "No decoder available for local environment. "
                    "Install PyAV: pip install av"
                )
        else:
            # Staging/production (Modal) - use NVDEC
            decoder_type = "nvdec"

    decoder_type = decoder_type.lower()

    if decoder_type == "nvdec":
        if NVDECDecoder is None:
            raise ValueError(
                "NVDECDecoder not available. Install PyNvVideoCodec and PyTorch with CUDA: "
                "pip install nvidia-pynvvideocodec torch"
            )
        return NVDECDecoder(video_path, **kwargs)

    elif decoder_type == "videotoolbox":
        if VideoToolboxDecoder is None:
            raise ValueError(
                "VideoToolboxDecoder not available. Install PyAV >= 14.0: "
                "pip install av>=14.0"
            )
        if not VIDEOTOOLBOX_AVAILABLE:
            raise ValueError(
                "VideoToolbox hardware acceleration not available. "
                "This requires macOS with VideoToolbox support."
            )
        return VideoToolboxDecoder(video_path, **kwargs)

    elif decoder_type == "software":
        if SoftwareDecoder is None:
            raise ValueError(
                "SoftwareDecoder not available. Install PyAV: pip install av"
            )
        return SoftwareDecoder(video_path, **kwargs)

    else:
        available = []
        if NVDECDecoder is not None:
            available.append("nvdec")
        if VideoToolboxDecoder is not None:
            available.append("videotoolbox")
        if SoftwareDecoder is not None:
            available.append("software")

        raise ValueError(
            f"Unknown decoder type: {decoder_type}. "
            f"Available decoders: {available}"
        )


__all__ = [
    # Base classes
    "VideoDecoder",
    "BaseVideoDecoder",
    "VideoDecoderError",
    "DecodeError",
    "ResourceError",
    # Decoder implementations
    "NVDECDecoder",
    "VideoToolboxDecoder",
    "SoftwareDecoder",
    # Factory function
    "get_decoder",
    # Legacy alias
    "GPUVideoDecoder",
    # Frame extraction
    "extract_frames_gpu",
    "extract_frames_for_montage",
    # Montage functions
    "calculate_montage_capacity",
    "create_vertical_montage_gpu",
    "create_vertical_montage_cpu",
    "create_vertical_montage_from_pil",
    "MontageValidationError",
]
