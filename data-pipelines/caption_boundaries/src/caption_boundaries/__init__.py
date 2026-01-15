"""Caption Boundaries Detection Pipeline.

Deep learning pipeline for detecting caption boundary transitions by comparing
consecutive cropped caption frames.
"""

__all__ = ["__version__"]

try:
    from caption_boundaries._version import __version__
except ImportError:
    __version__ = "unknown"
