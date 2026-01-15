"""Google Cloud Vision API backend for OCR processing."""

import json
import os

from google.cloud import vision
from google.oauth2 import service_account

from ..models import BoundingBox, CharacterResult, OCRResult
from .base import OCRBackend


class GoogleVisionBackend(OCRBackend):
    """Google Vision API backend using SERVICE_ACCOUNT_JSON for credentials."""

    def __init__(self, credentials_json: str | None = None):
        """Initialize with credentials.

        Args:
            credentials_json: JSON string with service account credentials.
                            If not provided, reads from SERVICE_ACCOUNT_JSON env var.
        """
        if credentials_json is None:
            credentials_json = os.environ.get("SERVICE_ACCOUNT_JSON")

        if credentials_json:
            service_account_info = json.loads(credentials_json)
            credentials = service_account.Credentials.from_service_account_info(
                service_account_info
            )
            self.client = vision.ImageAnnotatorClient(credentials=credentials)
        else:
            # Fall back to default credentials (GOOGLE_APPLICATION_CREDENTIALS)
            self.client = vision.ImageAnnotatorClient()

    def get_constraints(self) -> dict:
        """Return Google Vision API constraints."""
        # Google Vision limits - see docs
        return {
            "max_image_height": 50000,  # Conservative estimate
            "max_image_width": 50000,
            "max_file_size_bytes": 20 * 1024 * 1024,  # 20MB
        }

    def process_single(self, image_bytes: bytes, language: str) -> OCRResult:
        """Process single image with document_text_detection.

        Args:
            image_bytes: Raw image bytes to process
            language: Language code for OCR hints (e.g., "zh", "en")

        Returns:
            OCRResult with character-level bounding boxes and full text
        """
        # Create image object
        image = vision.Image(content=image_bytes)

        # Call Google Vision API with language hints
        image_context = {"language_hints": [language]}
        response = self.client.document_text_detection(
            image=image, image_context=image_context
        )

        # Check for errors
        if response.error.message:
            raise RuntimeError(f"Google Vision API error: {response.error.message}")

        # Parse symbols (characters) from response
        characters = []
        if response.full_text_annotation:
            for page in response.full_text_annotation.pages:
                for block in page.blocks:
                    for paragraph in block.paragraphs:
                        for word in paragraph.words:
                            for symbol in word.symbols:
                                # Extract bounding box vertices
                                vertices = symbol.bounding_box.vertices
                                x = min(v.x for v in vertices)
                                y = min(v.y for v in vertices)
                                w = max(v.x for v in vertices) - x
                                h = max(v.y for v in vertices) - y

                                # Create CharacterResult
                                char_result = CharacterResult(
                                    text=symbol.text,
                                    bbox=BoundingBox(x=x, y=y, width=w, height=h),
                                )
                                characters.append(char_result)

        # Concatenate all character text
        full_text = "".join(char.text for char in characters)

        # Return OCRResult
        # Note: 'id' will be set by the caller/processor
        return OCRResult(
            id="",  # Will be set by caller
            characters=characters,
            text=full_text,
            char_count=len(characters),
        )
