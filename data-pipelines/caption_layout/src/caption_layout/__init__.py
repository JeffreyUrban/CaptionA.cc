"""caption_layout - TEMPLATE_PLACEHOLDER."""

from .caption_layout import CaptionLayout

# Version is managed by hatch-vcs and set during build
try:
    from ._version import __version__
except ImportError:
    # Fallback for development installs without build
    __version__ = "0.0.0.dev0+unknown"

__all__ = ["CaptionLayout", "__version__"]
