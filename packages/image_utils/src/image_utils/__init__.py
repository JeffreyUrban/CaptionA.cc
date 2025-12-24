"""Shared image processing utilities."""

from image_utils.processing import resize_directory, resize_image

try:
    from image_utils._version import __version__, __version_tuple__
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "unknown")

__all__ = [
    "__version__",
    "__version_tuple__",
    "resize_image",
    "resize_directory",
]
