#!/usr/bin/env python3
"""
OCR Batch Processing Service

Independent microservice for batch OCR processing using vertical montage stacking.
Handles any set of identically-dimensioned images and returns structured results.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Optional, Tuple
from io import BytesIO
from PIL import Image
import asyncio
import time
import math
import base64

import os
import json

try:
    from google.cloud import vision

    # Handle Fly.io secrets (JSON stored as environment variable)
    if os.getenv('GOOGLE_APPLICATION_CREDENTIALS_JSON'):
        creds_json = os.getenv('GOOGLE_APPLICATION_CREDENTIALS_JSON')
        # Write to temp file for google-cloud-vision
        with open('/tmp/gcp-credentials.json', 'w') as f:
            f.write(creds_json)
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = '/tmp/gcp-credentials.json'

    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    GOOGLE_CLOUD_AVAILABLE = False


app = FastAPI(
    title="OCR Batch Processing Service",
    description="Batch OCR processing with automatic montage optimization",
    version="1.0.0"
)


# Configuration constants
HEIGHT_LIMIT = 50000  # Conservative height limit (below JPEG 65,500px)
FILE_SIZE_LIMIT_MB = 15  # Conservative file size limit
PIXEL_LIMIT = 50000000  # Total pixel limit
SEPARATOR_PX = 2  # Separator between stacked images


class ImageDimensions(BaseModel):
    """Image dimensions for capacity calculation."""
    width: int = Field(..., gt=0, description="Image width in pixels")
    height: int = Field(..., gt=0, description="Image height in pixels")


class CapacityResponse(BaseModel):
    """Response for capacity calculation."""
    max_images: int
    limits: Dict[str, int]
    limiting_factor: str
    estimated_file_size_mb: float


class ImageInput(BaseModel):
    """Input image with identifier."""
    id: str = Field(..., description="Unique identifier for this image")
    data: str = Field(..., description="Base64-encoded image data")

    @field_validator('data')
    @classmethod
    def validate_base64(cls, v: str) -> str:
        """Validate that data is valid base64."""
        try:
            base64.b64decode(v)
            return v
        except Exception:
            raise ValueError("Invalid base64 data")


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


class ImageOCRResult(BaseModel):
    """OCR results for a single image."""
    id: str
    characters: List[CharacterResult]
    text: str
    char_count: int


class BatchOCRResponse(BaseModel):
    """Response for batch OCR processing."""
    results: List[ImageOCRResult]
    processing_time_ms: float
    total_characters: int
    images_processed: int


def calculate_capacity(width: int, height: int) -> Tuple[int, Dict[str, int], str]:
    """
    Calculate maximum number of images that can be safely processed.

    Returns:
        (max_images, limits_dict, limiting_factor)
    """
    # Calculate max by height
    max_by_height = (HEIGHT_LIMIT + SEPARATOR_PX) // (height + SEPARATOR_PX)

    # Calculate max by total pixels
    max_by_pixels = PIXEL_LIMIT // (width * height)

    # Estimate max by file size (rough estimate based on observed compression)
    # Based on test: 950 frames @ 666×64 = 15.41 MB
    # Bytes per frame ≈ (15.41 * 1024 * 1024) / 950 ≈ 17,018 bytes/frame
    # Adjusted by pixel ratio
    reference_bytes_per_frame = (15.41 * 1024 * 1024) / 950
    reference_pixels_per_frame = 666 * 64
    estimated_bytes_per_frame = reference_bytes_per_frame * (width * height) / reference_pixels_per_frame
    max_by_size = int((FILE_SIZE_LIMIT_MB * 1024 * 1024) / estimated_bytes_per_frame)

    limits = {
        "by_height": max_by_height,
        "by_pixels": max_by_pixels,
        "by_file_size": max_by_size
    }

    # Find minimum (most restrictive)
    max_images = min(max_by_height, max_by_pixels, max_by_size)

    if max_images == max_by_height:
        limiting_factor = "height"
    elif max_images == max_by_pixels:
        limiting_factor = "total_pixels"
    else:
        limiting_factor = "file_size"

    # Estimate final file size
    estimated_file_size_mb = (estimated_bytes_per_frame * max_images) / (1024 * 1024)

    return max_images, limits, limiting_factor, estimated_file_size_mb


def create_vertical_montage(images: List[Tuple[str, bytes]], separator_px: int = SEPARATOR_PX) -> Tuple[bytes, List[Dict]]:
    """
    Create vertical montage from list of images.

    Args:
        images: List of (id, image_data) tuples
        separator_px: Pixels between images

    Returns:
        (montage_bytes, metadata_list)
        metadata_list contains position info for each image
    """
    if not images:
        raise ValueError("No images provided")

    # Load first image to get dimensions
    first_img = Image.open(BytesIO(images[0][1]))
    width = first_img.width
    height = first_img.height

    # Calculate total height
    total_height = sum(height for _ in images) + (len(images) - 1) * separator_px

    # Check height limit
    if total_height > HEIGHT_LIMIT:
        raise ValueError(f"Total height {total_height}px exceeds limit {HEIGHT_LIMIT}px")

    # Create montage
    montage = Image.new('RGB', (width, total_height), (220, 220, 220))

    metadata = []
    y_offset = 0

    for img_id, img_data in images:
        img = Image.open(BytesIO(img_data))

        # Verify dimensions match
        if img.width != width or img.height != height:
            raise ValueError(f"Image {img_id} dimensions {img.width}×{img.height} don't match expected {width}×{height}")

        # Paste image
        montage.paste(img, (0, y_offset))

        # Store metadata
        metadata.append({
            'id': img_id,
            'x': 0,
            'y': y_offset,
            'width': width,
            'height': height
        })

        y_offset += height + separator_px

    # Save to bytes
    buffer = BytesIO()
    montage.save(buffer, format='JPEG', quality=95)

    return buffer.getvalue(), metadata


async def call_gcp_vision_api(image_bytes: bytes) -> Dict:
    """
    Call Google Cloud Vision API for document text detection.

    Returns structured results with character-level bounding boxes.
    """
    if not GOOGLE_CLOUD_AVAILABLE:
        raise RuntimeError("google-cloud-vision not available")

    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)

    start = time.time()

    # Run in executor to avoid blocking
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: client.document_text_detection(
            image=image,
            image_context={'language_hints': ['zh']}
        )
    )

    elapsed_ms = (time.time() - start) * 1000

    # Parse symbols (characters)
    symbols = []
    if response.full_text_annotation:
        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        for symbol in word.symbols:
                            vertices = symbol.bounding_box.vertices
                            x = min(v.x for v in vertices)
                            y = min(v.y for v in vertices)
                            w = max(v.x for v in vertices) - x
                            h = max(v.y for v in vertices) - y

                            symbols.append({
                                'text': symbol.text,
                                'bbox': {
                                    'x': x,
                                    'y': y,
                                    'width': w,
                                    'height': h
                                }
                            })

    return {
        'processing_time_ms': elapsed_ms,
        'symbols': symbols,
        'total_characters': len(symbols)
    }


def distribute_characters_to_images(symbols: List[Dict], image_metadata: List[Dict]) -> List[ImageOCRResult]:
    """
    Distribute detected characters back to their original images based on position.

    Args:
        symbols: List of characters with bounding boxes in montage coordinates
        image_metadata: List of image positions in montage

    Returns:
        List of ImageOCRResult, one per image
    """
    results = []

    for img_meta in image_metadata:
        img_id = img_meta['id']
        img_x = img_meta['x']
        img_y = img_meta['y']
        img_w = img_meta['width']
        img_h = img_meta['height']

        # Find characters that fall within this image's bounds
        img_chars = []

        for symbol in symbols:
            bbox = symbol['bbox']
            char_x = bbox['x']
            char_y = bbox['y']

            # Check if character center is within image bounds
            char_center_y = char_y + bbox['height'] / 2

            if (char_center_y >= img_y and
                char_center_y < img_y + img_h):

                # Transform coordinates to image-relative
                relative_bbox = BoundingBox(
                    x=char_x - img_x,
                    y=char_y - img_y,
                    width=bbox['width'],
                    height=bbox['height']
                )

                img_chars.append(CharacterResult(
                    text=symbol['text'],
                    bbox=relative_bbox
                ))

        # Create result
        text = ''.join(c.text for c in img_chars)
        results.append(ImageOCRResult(
            id=img_id,
            characters=img_chars,
            text=text,
            char_count=len(img_chars)
        ))

    return results


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "OCR Batch Processing Service",
        "status": "healthy",
        "google_cloud_available": GOOGLE_CLOUD_AVAILABLE
    }


@app.post("/capacity", response_model=CapacityResponse)
async def get_capacity(dimensions: ImageDimensions):
    """
    Calculate maximum number of images that can be processed for given dimensions.

    This helps clients determine optimal batch sizes before sending images.
    """
    max_images, limits, limiting_factor, estimated_size = calculate_capacity(
        dimensions.width,
        dimensions.height
    )

    return CapacityResponse(
        max_images=max_images,
        limits=limits,
        limiting_factor=limiting_factor,
        estimated_file_size_mb=estimated_size
    )


@app.post("/ocr/batch", response_model=BatchOCRResponse)
async def process_batch(images: List[ImageInput]):
    """
    Process a batch of identically-sized images and return OCR results per image.

    Images are automatically arranged in a vertical montage for efficient processing.
    Results are returned with original image IDs for easy mapping.
    """
    if not images:
        raise HTTPException(status_code=400, detail="No images provided")

    if not GOOGLE_CLOUD_AVAILABLE:
        raise HTTPException(status_code=503, detail="Google Cloud Vision not available")

    try:
        # Decode base64 and convert to format for montage creation
        image_list = [(img.id, base64.b64decode(img.data)) for img in images]

        # Create montage
        montage_bytes, metadata = create_vertical_montage(image_list)

        # Call OCR API
        ocr_result = await call_gcp_vision_api(montage_bytes)

        # Distribute characters back to images
        results = distribute_characters_to_images(ocr_result['symbols'], metadata)

        return BatchOCRResponse(
            results=results,
            processing_time_ms=ocr_result['processing_time_ms'],
            total_characters=ocr_result['total_characters'],
            images_processed=len(images)
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
