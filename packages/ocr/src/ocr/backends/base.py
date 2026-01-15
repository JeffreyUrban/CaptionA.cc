"""Abstract base class for OCR backends."""

from abc import ABC, abstractmethod

from ..models import OCRResult


class OCRBackend(ABC):
    """Abstract base class for OCR backends. Backends process SINGLE images only."""

    @abstractmethod
    def get_constraints(self) -> dict:
        """Return backend constraints for batch size calculation.

        Returns dict with keys like: max_image_height, max_image_width, max_file_size_bytes
        """
        ...

    @abstractmethod
    def process_single(self, image_bytes: bytes, language: str) -> OCRResult:
        """Process a single image and return OCR results."""
        ...
