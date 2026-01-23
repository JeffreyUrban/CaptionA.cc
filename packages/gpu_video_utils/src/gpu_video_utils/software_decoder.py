"""Software video decoder using PyAV (CPU-based, cross-platform)."""

from pathlib import Path

import numpy as np

from .base import BaseVideoDecoder, DecodeError, ResourceError

# Optional PyAV import
try:
    import av

    PYAV_AVAILABLE = True
except ImportError:
    PYAV_AVAILABLE = False
    av = None  # type: ignore


class SoftwareDecoder(BaseVideoDecoder):
    """Software video decoder using PyAV.

    Uses PyAV for CPU-based video decoding. This is the slowest option but
    works on all platforms without special hardware requirements.

    Requires:
        - PyAV package
    """

    def __init__(self, video_path: Path, thread_count: int = 0):
        """Initialize software video decoder.

        Args:
            video_path: Path to video file
            thread_count: Number of threads for decoding (0 = auto)

        Raises:
            ImportError: If PyAV is not available
            FileNotFoundError: If video file doesn't exist
        """
        if not PYAV_AVAILABLE:
            raise ImportError(
                "SoftwareDecoder requires PyAV. Install with: pip install av"
            )

        super().__init__(video_path)

        self._thread_count = thread_count
        self._container = None
        self._stream = None

        # Open container and initialize decoder
        self._init_decoder()

    def _init_decoder(self) -> None:
        """Initialize PyAV container for software decoding."""
        try:
            self._container = av.open(str(self._video_path))
            self._stream = self._container.streams.video[0]

            # Set thread count for parallel decoding
            if self._thread_count > 0:
                self._stream.codec_context.thread_count = self._thread_count

            # Cache video metadata
            self._total_frames = self._stream.frames
            if self._total_frames == 0:
                # Some containers don't report frame count, estimate from duration
                if self._stream.duration and self._stream.time_base:
                    duration_sec = float(self._stream.duration * self._stream.time_base)
                    fps = float(self._stream.average_rate or self._stream.base_rate or 25)
                    self._total_frames = int(duration_sec * fps)

            self._native_fps = float(self._stream.average_rate or self._stream.base_rate or 25)
            self._frame_width = self._stream.width
            self._frame_height = self._stream.height
            self._codec = self._stream.codec_context.name
            self._bitrate = self._container.bit_rate or 0

            # Calculate duration
            if self._stream.duration and self._stream.time_base:
                self._duration = float(self._stream.duration * self._stream.time_base)
            elif self._total_frames and self._native_fps:
                self._duration = self._total_frames / self._native_fps
            else:
                self._duration = 0.0

            # Frame tracking for sequential access
            self._frame_cache: dict[int, np.ndarray] = {}
            self._current_frame_idx = -1

        except Exception as e:
            raise ResourceError(f"Failed to open video: {e}")

    def __len__(self) -> int:
        """Return total number of frames in video."""
        return self._total_frames or 0

    def get_video_info(self) -> dict:
        """Get video metadata.

        Returns:
            Dict with keys: total_frames, fps, width, height, duration, codec, bitrate
        """
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

        Note: For efficient sequential access, frames are decoded in order.
        Random seeking may require re-decoding from the nearest keyframe.

        Args:
            frame_index: Native frame index (0 to total_frames-1)

        Returns:
            Frame as numpy array (H, W, C) in RGB format

        Raises:
            ValueError: If frame_index is out of bounds
            DecodeError: If frame cannot be decoded
        """
        total = self._total_frames or 0
        if frame_index < 0 or frame_index >= total:
            raise ValueError(f"Frame index {frame_index} out of bounds [0, {total})")

        # Check cache first
        if frame_index in self._frame_cache:
            return self._frame_cache[frame_index]

        try:
            # If seeking backward or far forward, seek to nearest keyframe
            if frame_index < self._current_frame_idx or frame_index > self._current_frame_idx + 100:
                self._seek_to_frame(frame_index)

            # Decode frames until we reach target
            while self._current_frame_idx < frame_index:
                frame = self._decode_next_frame()
                if frame is None:
                    raise DecodeError(f"Reached end of stream before frame {frame_index}")
                self._current_frame_idx += 1

                # Cache the frame if it's our target
                if self._current_frame_idx == frame_index:
                    frame_array = frame.to_ndarray(format="rgb24")
                    self._frame_cache[frame_index] = frame_array
                    # Limit cache size
                    if len(self._frame_cache) > 100:
                        oldest = min(self._frame_cache.keys())
                        del self._frame_cache[oldest]
                    return frame_array

            # Should have the frame now
            if frame_index in self._frame_cache:
                return self._frame_cache[frame_index]

            raise DecodeError(f"Failed to decode frame {frame_index}")

        except Exception as e:
            if isinstance(e, (DecodeError, ValueError)):
                raise
            raise DecodeError(f"Failed to decode frame {frame_index}: {e}")

    def _seek_to_frame(self, frame_index: int) -> None:
        """Seek to the nearest keyframe before the target frame."""
        if self._container is None or self._stream is None:
            raise DecodeError("Container not initialized")

        # Calculate timestamp for seeking
        if self._native_fps:
            target_pts = int(frame_index / self._native_fps / self._stream.time_base)
        else:
            target_pts = frame_index

        # Seek to nearest keyframe
        self._container.seek(target_pts, stream=self._stream)

        # Reset frame counter
        self._current_frame_idx = max(0, frame_index - 30)
        self._frame_cache.clear()

    def _decode_next_frame(self):
        """Decode the next frame from the stream."""
        if self._container is None:
            return None

        for packet in self._container.demux(self._stream):
            for frame in packet.decode():
                return frame
        return None

    def close(self) -> None:
        """Close decoder and free resources."""
        if self._container is not None:
            self._container.close()
            self._container = None
        self._stream = None
        self._frame_cache.clear()
