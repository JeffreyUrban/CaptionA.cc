"""Modal deployment entry point for extract-full-frames-and-ocr GPU + OCR processing.

Run as `modal deploy deploy.py` from the data-pipelines/extract-full-frames-and-ocr directory,
or `modal deploy data-pipelines/extract-full-frames-and-ocr/deploy.py` from the repo root.

This file imports and exposes the Modal app for deployment.
"""

from extract_full_frames_and_ocr.app import app

if __name__ == "__main__":
    # This allows Modal CLI to discover the app
    pass
