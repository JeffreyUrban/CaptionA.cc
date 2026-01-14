"""Montage creation and OCR result distribution for batch processing."""

from io import BytesIO
from typing import Dict, List, Tuple

from PIL import Image

from .models import BoundingBox, CharacterResult, OCRResult

SEPARATOR_PX = 2


def create_vertical_montage(
    images: List[Tuple[str, bytes]],
    separator_px: int = SEPARATOR_PX,
) -> Tuple[bytes, List[Dict]]:
    """Create vertical montage from list of images.

    Args:
        images: List of (id, image_bytes) tuples
        separator_px: Pixels between images

    Returns:
        (montage_bytes, metadata_list)
        metadata_list: [{"id": str, "x": int, "y": int, "width": int, "height": int}, ...]

    Raises:
        ValueError: If no images provided or image dimensions don't match.
    """
    if not images:
        raise ValueError("No images provided")

    # Load first image to get dimensions
    first_img = Image.open(BytesIO(images[0][1]))
    width = first_img.width
    height = first_img.height

    # Calculate total height
    total_height = sum(height for _ in images) + (len(images) - 1) * separator_px

    # Create montage with gray separator color
    montage = Image.new("RGB", (width, total_height), (220, 220, 220))

    metadata: List[Dict] = []
    y_offset = 0

    for img_id, img_data in images:
        img = Image.open(BytesIO(img_data))

        # Verify dimensions match
        if img.width != width or img.height != height:
            raise ValueError(
                f"Image {img_id} dimensions {img.width}x{img.height} "
                f"don't match expected {width}x{height}"
            )

        # Paste image
        montage.paste(img, (0, y_offset))

        # Store metadata
        metadata.append({
            "id": img_id,
            "x": 0,
            "y": y_offset,
            "width": width,
            "height": height,
        })

        y_offset += height + separator_px

    # Save to bytes
    buffer = BytesIO()
    montage.save(buffer, format="JPEG", quality=95)

    return buffer.getvalue(), metadata


def distribute_results_to_images(
    ocr_result: OCRResult,
    metadata: List[Dict],
) -> List[OCRResult]:
    """Distribute OCR results from montage back to individual images.

    Takes OCR results from a montage and splits them back to individual
    images based on character positions and image metadata.

    Args:
        ocr_result: OCR result from processing the montage
        metadata: List of image positions from create_vertical_montage()

    Returns:
        List of OCRResult, one per original image
    """
    results: List[OCRResult] = []

    for img_meta in metadata:
        img_id = img_meta["id"]
        img_x = img_meta["x"]
        img_y = img_meta["y"]
        img_h = img_meta["height"]

        # Find characters that fall within this image's bounds
        img_chars: List[CharacterResult] = []

        for char in ocr_result.characters:
            bbox = char.bbox

            # Check if character center is within image bounds
            char_center_y = bbox.y + bbox.height / 2

            if img_y <= char_center_y < img_y + img_h:
                # Transform coordinates to image-relative
                relative_bbox = BoundingBox(
                    x=bbox.x - img_x,
                    y=bbox.y - img_y,
                    width=bbox.width,
                    height=bbox.height,
                )

                img_chars.append(CharacterResult(text=char.text, bbox=relative_bbox))

        # Create result for this image
        text = "".join(c.text for c in img_chars)
        results.append(OCRResult(
            id=img_id,
            characters=img_chars,
            text=text,
            char_count=len(img_chars),
        ))

    return results
