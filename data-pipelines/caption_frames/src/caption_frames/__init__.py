"""caption_frames - Extract and process video frames for caption regions."""

from .caption_frames import extract_frames, resize_frames

# Version is managed by hatch-vcs and set during build
try:
    from ._version import __version__
except ImportError:
    # Fallback for development installs without build
    __version__ = "0.0.0.dev0+unknown"

__all__ = [
    "extract_frames",
    "resize_frames",
    "__version__",
]
