"""Modal deployment entry point for extract-full-frames-and-ocr GPU + OCR processing.

Run as `modal deploy deploy.py` from the data-pipelines/extract-full-frames-and-ocr directory.

This file tells Modal where to find the app.
"""

# Modal will look for the app in the specified module
__modal_stub__ = "src.extract_full_frames_and_ocr.app:app"
