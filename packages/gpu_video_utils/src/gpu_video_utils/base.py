"""Base class and protocol for video decoders."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np


class VideoDecoderError(Exception):
    """Base exception for video decoder errors."""

    pass


class DecodeError(VideoDecoderError):
    """Raised when frame decoding fails."""

    pass


class ResourceError(VideoDecoderError):
    """Raised when resources are unavailable."""

    pass


@runtime_checkable
class VideoDecoder(Protocol):
    """Protocol for video decoders with hardware acceleration support.

    All decoders must implement this interface to be interchangeable.
    """

    @property
    def video_path(self) -> Path:
        """Path to the video file."""
        ...

    def __len__(self) -> int:
        """Return total number of frames in video."""
        ...

    def get_video_info(self) -> dict:
        """Get video metadata.

        Returns:
            Dict with keys: total_frames, fps, width, height, duration, codec, bitrate
        """
        ...

    def get_frame_at_index(self, frame_index: int) -> np.ndarray:
        """Extract single frame at native frame index.

        Args:
            frame_index: Native frame index (0 to total_frames-1)

        Returns:
            Frame as numpy array (H, W, C) in RGB format

        Raises:
            ValueError: If frame_index is out of bounds
            DecodeError: If frame cannot be decoded
        """
        ...

    def get_frame_at_time(self, time_seconds: float) -> np.ndarray:
        """Extract frame at specific timestamp.

        Args:
            time_seconds: Timestamp in seconds

        Returns:
            Frame as numpy array (H, W, C) in RGB format
        """
        ...

    def close(self) -> None:
        """Close decoder and free resources."""
        ...


class BaseVideoDecoder(ABC):
    """Abstract base class for video decoders.

    Provides common functionality and enforces the VideoDecoder protocol.
    """

    def __init__(self, video_path: Path):
        """Initialize decoder.

        Args:
            video_path: Path to video file

        Raises:
            FileNotFoundError: If video file doesn't exist
        """
        self._video_path = Path(video_path)
        if not self._video_path.exists():
            raise FileNotFoundError(f"Video file not found: {self._video_path}")

        # Cache for video metadata
        self._total_frames: int | None = None
        self._native_fps: float | None = None
        self._frame_width: int | None = None
        self._frame_height: int | None = None
        self._codec: str | None = None
        self._bitrate: int | None = None
        self._duration: float | None = None

    @property
    def video_path(self) -> Path:
        """Path to the video file."""
        return self._video_path

    @abstractmethod
    def __len__(self) -> int:
        """Return total number of frames in video."""
        ...

    @abstractmethod
    def get_video_info(self) -> dict:
        """Get video metadata."""
        ...

    @abstractmethod
    def get_frame_at_index(self, frame_index: int) -> np.ndarray:
        """Extract single frame at native frame index."""
        ...

    def get_frame_at_time(self, time_seconds: float) -> np.ndarray:
        """Extract frame at specific timestamp.

        Uses precise timing: native_frame_idx = round(time * native_fps)

        Args:
            time_seconds: Timestamp in seconds

        Returns:
            Frame as numpy array (H, W, C) in RGB format
        """
        # Ensure video info is loaded
        if self._native_fps is None:
            self.get_video_info()

        assert self._native_fps is not None
        assert self._total_frames is not None

        # Calculate native frame index
        native_frame_idx = round(time_seconds * self._native_fps)
        native_frame_idx = min(native_frame_idx, self._total_frames - 1)
        native_frame_idx = max(0, native_frame_idx)

        return self.get_frame_at_index(native_frame_idx)

    def get_frames_at_times(self, times: list[float]) -> list[np.ndarray]:
        """Extract frames at multiple timestamps.

        Args:
            times: List of timestamps in seconds

        Returns:
            List of frames as numpy arrays
        """
        return [self.get_frame_at_time(t) for t in times]

    @abstractmethod
    def close(self) -> None:
        """Close decoder and free resources."""
        ...

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
        return False
