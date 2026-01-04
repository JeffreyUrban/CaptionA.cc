"""Prefect flow definitions for video processing orchestration."""

from .video_processing import process_video_initial_flow
from .crop_frames import crop_frames_flow
from .caption_median_ocr import caption_median_ocr_flow
from .base_model_update import base_model_update_flow
from .video_model_retrain import retrain_video_model_flow

__all__ = [
    "process_video_initial_flow",
    "crop_frames_flow",
    "caption_median_ocr_flow",
    "base_model_update_flow",
    "retrain_video_model_flow",
]
