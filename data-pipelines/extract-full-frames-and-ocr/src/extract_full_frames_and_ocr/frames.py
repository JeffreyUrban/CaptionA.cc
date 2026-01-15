"""Frame extraction from video using FFmpeg.

This module re-exports functions from the shared video_utils package.
"""

from video_utils import extract_frames, get_video_dimensions, get_video_duration

__all__ = ["extract_frames", "get_video_dimensions", "get_video_duration"]
