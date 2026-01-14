"""GPU video decoder wrapper using PyNvVideoCodec."""

import time
from pathlib import Path

import torch

try:
    import PyNvVideoCodec as nvvc
except ImportError:
    raise ImportError(
        "PyNvVideoCodec is required for GPU video processing. "
        "Install with: pip install nvidia-pynvvideocodec"
    ) from None


class GPUDecoderError(Exception):
    """Base exception for GPU decoder errors."""
    pass


class GPUDecodeError(GPUDecoderError):
    """Raised when frame decoding fails."""
    pass


class GPUResourceError(GPUDecoderError):
    """Raised when GPU resources are unavailable."""
    pass


class GPUVideoDecoder:
    """Wrapper around PyNvVideoCodec SimpleDecoder with convenience methods.

    Provides GPU-accelerated video decoding with precise frame extraction.
    """

    def __init__(self, video_path: Path, gpu_id: int = 0, max_retries: int = 3):
        """Initialize GPU video decoder with retry logic.

        Args:
            video_path: Path to video file
            gpu_id: GPU device ID (default: 0)
            max_retries: Maximum retries for transient GPU errors (default: 3)

        Raises:
            GPUResourceError: If GPU resources unavailable after retries
            FileNotFoundError: If video file doesn't exist
        """
        self.video_path = Path(video_path)
        self.gpu_id = gpu_id
        self.max_retries = max_retries

        if not self.video_path.exists():
            raise FileNotFoundError(f"Video file not found: {self.video_path}")

        # Initialize decoder with retry logic
        self.decoder = self._init_decoder_with_retry()

        # Cache video metadata
        self._total_frames = len(self.decoder)
        self._native_fps: float | None = None
        self._frame_width: int | None = None
        self._frame_height: int | None = None

    def _init_decoder_with_retry(self):
        """Initialize decoder with exponential backoff retry."""
        last_error = None

        for attempt in range(self.max_retries):
            try:
                decoder = nvvc.SimpleDecoder(
                    enc_file_path=str(self.video_path),
                    gpu_id=self.gpu_id,
                    use_device_memory=True,
                    output_color_type=nvvc.OutputColorType.RGB,
                )
                return decoder

            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    # Exponential backoff: 0.1s, 0.2s, 0.4s
                    wait_time = 0.1 * (2 ** attempt)
                    print(f"GPU decoder initialization failed (attempt {attempt + 1}/{self.max_retries}), "
                          f"retrying in {wait_time:.1f}s: {e}")
                    time.sleep(wait_time)
                else:
                    print(f"GPU decoder initialization failed after {self.max_retries} attempts")

        raise GPUResourceError(
            f"Failed to initialize GPU decoder after {self.max_retries} attempts: {last_error}"
        )

    def __len__(self) -> int:
        """Return total number of frames in video."""
        return self._total_frames

    def get_video_info(self) -> dict:
        """Get video metadata.

        Returns:
            Dict with keys: total_frames, fps, width, height, duration
        """
        # Get native FPS (need to probe first frame)
        if self._native_fps is None:
            # Probe first frame to get dimensions and infer FPS
            # PyNvVideoCodec doesn't expose FPS directly, so we'll need to use ffprobe
            import ffmpeg
            probe = ffmpeg.probe(str(self.video_path))
            video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")

            # Parse FPS from r_frame_rate (e.g., "25/1" -> 25.0)
            fps_str = video_stream.get("r_frame_rate", "25/1")
            fps_parts = fps_str.split("/")
            self._native_fps = float(fps_parts[0]) / float(fps_parts[1])

            self._frame_width = int(video_stream["width"])
            self._frame_height = int(video_stream["height"])

        duration = self._total_frames / self._native_fps

        return {
            "total_frames": self._total_frames,
            "fps": self._native_fps,
            "width": self._frame_width,
            "height": self._frame_height,
            "duration": duration,
        }

    def get_frame_at_index(self, frame_index: int) -> torch.Tensor:
        """Extract single frame at native frame index with retry logic.

        Args:
            frame_index: Native frame index (0 to total_frames-1)

        Returns:
            Frame as GPU tensor (H, W, C) in RGB format

        Raises:
            ValueError: If frame_index is out of bounds
            GPUDecodeError: If frame cannot be decoded after retries
        """
        if frame_index < 0 or frame_index >= self._total_frames:
            raise ValueError(
                f"Frame index {frame_index} out of bounds [0, {self._total_frames})"
            )

        last_error = None

        for attempt in range(self.max_retries):
            try:
                # Decode frame (returns DLPack capsule)
                frame_dlpack = self.decoder[frame_index]

                if frame_dlpack is None:
                    raise GPUDecodeError(f"Decoder returned None for frame {frame_index}")

                # Convert DLPack to PyTorch tensor (zero-copy on GPU)
                frame_tensor = torch.from_dlpack(frame_dlpack)

                return frame_tensor

            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    # Short retry delay for decode errors
                    wait_time = 0.05 * (2 ** attempt)
                    print(f"Frame decode failed at index {frame_index} (attempt {attempt + 1}/{self.max_retries}), "
                          f"retrying in {wait_time:.3f}s: {e}")
                    time.sleep(wait_time)

        raise GPUDecodeError(
            f"Failed to decode frame at index {frame_index} after {self.max_retries} attempts: {last_error}"
        )

    def get_frame_at_time(self, time_seconds: float) -> torch.Tensor:
        """Extract frame at specific timestamp (GPU tensor).

        Uses precise timing: native_frame_idx = round(time * native_fps)

        Args:
            time_seconds: Timestamp in seconds

        Returns:
            Frame as GPU tensor (H, W, C) in RGB format
        """
        # Ensure video info is loaded
        if self._native_fps is None:
            self.get_video_info()

        assert self._native_fps is not None, "FPS should be loaded after get_video_info()"

        # Calculate native frame index
        native_frame_idx = round(time_seconds * self._native_fps)
        native_frame_idx = min(native_frame_idx, self._total_frames - 1)
        native_frame_idx = max(0, native_frame_idx)

        return self.get_frame_at_index(native_frame_idx)

    def get_frames_at_times(self, times: list[float]) -> list[torch.Tensor]:
        """Extract frames at multiple timestamps (GPU tensors).

        Args:
            times: List of timestamps in seconds

        Returns:
            List of frames as GPU tensors
        """
        return [self.get_frame_at_time(t) for t in times]

    def close(self):
        """Close decoder and free resources."""
        # PyNvVideoCodec SimpleDecoder doesn't have explicit close method
        # Resources are freed when object is deleted
        del self.decoder

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):  # type: ignore
        """Context manager exit."""
        self.close()
        return False
