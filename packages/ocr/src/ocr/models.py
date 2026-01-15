"""Data models for OCR results."""

from pydantic import BaseModel


class BoundingBox(BaseModel):
    """Character bounding box."""

    x: int
    y: int
    width: int
    height: int


class CharacterResult(BaseModel):
    """OCR result for a single character."""

    text: str
    bbox: BoundingBox


class OCRResult(BaseModel):
    """OCR results for a single image."""

    id: str
    characters: list[CharacterResult]
    text: str
    char_count: int
