"""Modal deployment entry point for extract-full-frames-and-ocr GPU + OCR processing.

Run as `modal deploy deploy.py` from the data-pipelines/extract-full-frames-and-ocr directory.

Prerequisites: Run `uv sync` first to install workspace dependencies.

This file imports and exposes the Modal app for deployment.
"""

from src.extract_full_frames_and_ocr.app import app

# Modal CLI will discover 'app' automatically
