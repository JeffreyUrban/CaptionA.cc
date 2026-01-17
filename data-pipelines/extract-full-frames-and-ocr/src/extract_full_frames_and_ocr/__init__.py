"""full_frames - Analyze the layout characteristics of burned-in captions in video."""

# Version is managed by hatch-vcs and set during build
try:
    from ._version import __version__
except ImportError:
    # Fallback for development installs without build
    __version__ = "0.0.0.dev0+unknown"

# Lazy import to avoid triggering GPU dependencies during Modal deployment
def __getattr__(name):
    if name == "process_video_with_gpu_and_ocr":
        from .pipeline import process_video_with_gpu_and_ocr
        return process_video_with_gpu_and_ocr
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = ["__version__", "process_video_with_gpu_and_ocr"]
