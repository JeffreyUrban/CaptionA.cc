"""Configuration for OCR service."""

import os

OCR_SERVICE_URL = os.getenv(
    "OCR_SERVICE_URL",
    "https://ocr-service.fly.dev",  # Default to deployed service
)

# Fallback behavior if OCR service unavailable
USE_OCRMAC_FALLBACK = os.getenv("USE_OCRMAC_FALLBACK", "false").lower() == "true"
