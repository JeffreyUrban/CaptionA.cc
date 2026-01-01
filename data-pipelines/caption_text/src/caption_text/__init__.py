"""Caption text extraction and correction pipeline.

This pipeline provides VLM-based caption text extraction from cropped frames,
with OCR comparison and LLM-based error correction.
"""

try:
    from ._version import __version__, __version_tuple__
except ImportError:
    __version__ = "0.0.0+unknown"
    __version_tuple__ = (0, 0, 0, "unknown", "")

__all__ = ["__version__", "__version_tuple__"]
