"""
Modal deployment entry point for extract-crop-frames-and-infer-extents.

Run as `modal deploy deploy.py`

This file imports and exposes the Modal app for deployment.
"""

from src.extract_crop_frames_and_infer_extents.app import app

# Modal CLI will discover 'app' automatically
