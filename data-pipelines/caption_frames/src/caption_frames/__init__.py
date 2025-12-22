"""caption_frames - TEMPLATE_PLACEHOLDER."""

from .caption_frames import CaptionFrames

# Version is managed by hatch-vcs and set during build
try:
    from ._version import __version__
except ImportError:
    # Fallback for development installs without build
    __version__ = "0.0.0.dev0+unknown"

__all__ = ["CaptionFrames", "__version__"]
