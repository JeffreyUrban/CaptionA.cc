"""Shared video processing utilities using FFmpeg."""

from video_utils.frames import (
    extract_frames,
    extract_frames_streaming,
    get_video_dimensions,
    get_video_duration,
)

try:
    from video_utils._version import __version__, __version_tuple__
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "unknown")

__all__ = [
    "__version__",
    "__version_tuple__",
    "extract_frames",
    "extract_frames_streaming",
    "get_video_dimensions",
    "get_video_duration",
]
