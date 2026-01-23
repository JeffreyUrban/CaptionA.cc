"""NVIDIA NVDEC hardware-accelerated video decoder using PyNvVideoCodec."""

import time
from pathlib import Path

import numpy as np

from .base import BaseVideoDecoder, DecodeError, ResourceError

# Optional NVIDIA import
try:
    import torch
    import PyNvVideoCodec as nvvc

    NVDEC_AVAILABLE = True
except ImportError:
    NVDEC_AVAILABLE = False
    torch = None  # type: ignore
    nvvc = None  # type: ignore


class NVDECDecoder(BaseVideoDecoder):
    """NVIDIA NVDEC hardware-accelerated video decoder.

    Uses PyNvVideoCodec for GPU-accelerated video decoding on NVIDIA GPUs.
    Frames are decoded directly to GPU memory and returned as numpy arrays.

    Requires:
        - NVIDIA GPU with NVDEC support
        - PyNvVideoCodec package
        - PyTorch with CUDA support
    """

    def __init__(self, video_path: Path, gpu_id: int = 0, max_retries: int = 3):
        """Initialize NVDEC video decoder.

        Args:
            video_path: Path to video file
            gpu_id: GPU device ID (default: 0)
            max_retries: Maximum retries for transient GPU errors (default: 3)

        Raises:
            ImportError: If PyNvVideoCodec is not available
            ResourceError: If GPU resources unavailable after retries
            FileNotFoundError: If video file doesn't exist
        """
        if not NVDEC_AVAILABLE:
            raise ImportError(
                "NVDECDecoder requires PyNvVideoCodec and PyTorch with CUDA. "
                "Install with: pip install nvidia-pynvvideocodec torch"
            )

        super().__init__(video_path)

        self.gpu_id = gpu_id
        self.max_retries = max_retries

        # Initialize decoder with retry logic
        self._decoder = self._init_decoder_with_retry()

        # Cache total frames from decoder
        self._total_frames = len(self._decoder)

    def _init_decoder_with_retry(self):
        """Initialize decoder with exponential backoff retry."""
        last_error = None

        for attempt in range(self.max_retries):
            try:
                decoder = nvvc.SimpleDecoder(
                    enc_file_path=str(self._video_path),
                    gpu_id=self.gpu_id,
                    use_device_memory=True,
                    output_color_type=nvvc.OutputColorType.RGB,
                )
                return decoder

            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    wait_time = 0.1 * (2**attempt)
                    print(
                        f"NVDEC decoder initialization failed (attempt {attempt + 1}/{self.max_retries}), "
                        f"retrying in {wait_time:.1f}s: {e}"
                    )
                    time.sleep(wait_time)
                else:
                    print(f"NVDEC decoder initialization failed after {self.max_retries} attempts")

        raise ResourceError(
            f"Failed to initialize NVDEC decoder after {self.max_retries} attempts: {last_error}"
        )

    def __len__(self) -> int:
        """Return total number of frames in video."""
        return self._total_frames or 0

    def get_video_info(self) -> dict:
        """Get video metadata.

        Returns:
            Dict with keys: total_frames, fps, width, height, duration, codec, bitrate
        """
        if self._native_fps is None:
            import ffmpeg

            probe = ffmpeg.probe(str(self._video_path))
            video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")

            fps_str = video_stream.get("r_frame_rate", "25/1")
            fps_parts = fps_str.split("/")
            self._native_fps = float(fps_parts[0]) / float(fps_parts[1])

            self._frame_width = int(video_stream["width"])
            self._frame_height = int(video_stream["height"])
            self._codec = video_stream.get("codec_name", "unknown")
            self._bitrate = int(video_stream.get("bit_rate", 0))

        self._duration = self._total_frames / self._native_fps if self._native_fps else 0

        return {
            "total_frames": self._total_frames,
            "fps": self._native_fps,
            "width": self._frame_width,
            "height": self._frame_height,
            "duration": self._duration,
            "codec": self._codec,
            "bitrate": self._bitrate,
        }

    def get_frame_at_index(self, frame_index: int) -> np.ndarray:
        """Extract single frame at native frame index.

        Args:
            frame_index: Native frame index (0 to total_frames-1)

        Returns:
            Frame as numpy array (H, W, C) in RGB format

        Raises:
            ValueError: If frame_index is out of bounds
            DecodeError: If frame cannot be decoded after retries
        """
        if frame_index < 0 or frame_index >= (self._total_frames or 0):
            raise ValueError(f"Frame index {frame_index} out of bounds [0, {self._total_frames})")

        last_error = None

        for attempt in range(self.max_retries):
            try:
                frame_dlpack = self._decoder[frame_index]

                if frame_dlpack is None:
                    raise DecodeError(f"Decoder returned None for frame {frame_index}")

                # Convert DLPack to PyTorch tensor (zero-copy on GPU)
                frame_tensor = torch.from_dlpack(frame_dlpack)

                # Transfer to CPU and convert to numpy
                return frame_tensor.cpu().numpy()

            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    wait_time = 0.05 * (2**attempt)
                    print(
                        f"Frame decode failed at index {frame_index} (attempt {attempt + 1}/{self.max_retries}), "
                        f"retrying in {wait_time:.3f}s: {e}"
                    )
                    time.sleep(wait_time)

        raise DecodeError(
            f"Failed to decode frame at index {frame_index} after {self.max_retries} attempts: {last_error}"
        )

    def get_frame_as_tensor(self, frame_index: int) -> "torch.Tensor":
        """Extract single frame as GPU tensor (for GPU-only workflows).

        Args:
            frame_index: Native frame index (0 to total_frames-1)

        Returns:
            Frame as GPU tensor (H, W, C) in RGB format
        """
        if frame_index < 0 or frame_index >= (self._total_frames or 0):
            raise ValueError(f"Frame index {frame_index} out of bounds [0, {self._total_frames})")

        frame_dlpack = self._decoder[frame_index]
        if frame_dlpack is None:
            raise DecodeError(f"Decoder returned None for frame {frame_index}")

        return torch.from_dlpack(frame_dlpack)

    def close(self) -> None:
        """Close decoder and free resources."""
        if hasattr(self, "_decoder") and self._decoder is not None:
            del self._decoder
            self._decoder = None


# Backward compatibility alias
GPUVideoDecoder = NVDECDecoder
