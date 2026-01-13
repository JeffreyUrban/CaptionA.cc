"""
Modal deployment entry point for CaptionA.cc processing functions.

This file imports and exposes the Modal app for deployment.
"""

from captionacc_modal.app import app

if __name__ == "__main__":
    # This allows Modal CLI to discover the app
    pass
