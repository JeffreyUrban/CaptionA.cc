"""Modal deployment entry point for full_frames GPU + OCR processing.

Run as `modal deploy deploy.py` from the data-pipelines/full_frames directory,
or `modal deploy data-pipelines/full_frames/deploy.py` from the repo root.

This file imports and exposes the Modal app for deployment.
"""

from full_frames.app import app

if __name__ == "__main__":
    # This allows Modal CLI to discover the app
    pass
