"""
Prefect flows for CaptionA.cc orchestration.

All flows execute in the API service process via Prefect agent.
"""

from .caption_ocr import caption_ocr
from .crop_and_infer import crop_and_infer
from .video_initial_processing import video_initial_processing

__all__ = [
    "caption_ocr",
    "crop_and_infer",
    "video_initial_processing",
]
