"""Caption Caption Frame Extents Detection Pipeline.

Deep learning pipeline for detecting caption frame extents by comparing
consecutive cropped caption frames.
"""

__all__ = ["__version__"]

try:
    from caption_frame_extents._version import __version__
except ImportError:
    __version__ = "unknown"
