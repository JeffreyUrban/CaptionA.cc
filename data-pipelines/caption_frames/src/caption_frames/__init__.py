"""caption_frames - Extract and process video frames for caption regions."""

from .caption_frames import extract_frames_from_episode, resize_frames_in_directory
from .streaming import stream_extract_and_resize, stream_extract_frames

# Version is managed by hatch-vcs and set during build
try:
    from ._version import __version__
except ImportError:
    # Fallback for development installs without build
    __version__ = "0.0.0.dev0+unknown"

__all__ = [
    "extract_frames_from_episode",
    "resize_frames_in_directory",
    "stream_extract_and_resize",
    "stream_extract_frames",
    "__version__",
]
