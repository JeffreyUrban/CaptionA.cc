#!/usr/bin/env python3
"""
Example client for OCR Batch Processing Service

This demonstrates how to use the service from external orchestration code.
"""

import requests
import base64
from pathlib import Path
from typing import List, Dict


class OCRServiceClient:
    """Client for OCR Batch Processing Service."""

    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url

    def get_capacity(self, width: int, height: int) -> Dict:
        """Get maximum batch size for given image dimensions."""
        response = requests.post(
            f"{self.base_url}/capacity",
            json={"width": width, "height": height}
        )
        response.raise_for_status()
        return response.json()

    def process_batch(self, images: List[Dict[str, any]]) -> Dict:
        """
        Process batch of images.

        Args:
            images: List of dicts with 'id' and 'data' (bytes)

        Returns:
            OCR results
        """
        # Convert bytes to base64 for JSON serialization
        payload = {
            "images": [
                {
                    "id": img["id"],
                    "data": base64.b64encode(img["data"]).decode('utf-8')
                }
                for img in images
            ]
        }

        response = requests.post(
            f"{self.base_url}/ocr/batch",
            json=payload
        )
        response.raise_for_status()
        return response.json()


def example_usage():
    """Example: Process cropped frames from a video."""
    import sqlite3

    client = OCRServiceClient()

    # Example: Load cropped frames from database
    video_dir = Path("local/data/95/95b2d9b2-2e2c-462c-9e2a-fb9a50c57398")
    cropping_db = video_dir / "cropping.db"

    # Get first frame to determine dimensions
    conn = sqlite3.connect(cropping_db)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT image_data, width, height
        FROM cropped_frames
        LIMIT 1
    """)
    sample_data, width, height = cursor.fetchone()

    # Check capacity
    print(f"Image dimensions: {width}×{height}")
    capacity = client.get_capacity(width, height)
    print(f"Max batch size: {capacity['max_images']}")
    print(f"Limiting factor: {capacity['limiting_factor']}")
    print()

    # Load a batch of frames
    batch_size = min(50, capacity['max_images'])
    cursor.execute(f"""
        SELECT frame_index, image_data
        FROM cropped_frames
        WHERE frame_index IN (255, 1204, 1735, 1876, 1972)
        ORDER BY frame_index
    """)

    images = []
    for frame_index, image_data in cursor.fetchall():
        images.append({
            "id": f"frame_{frame_index}",
            "data": image_data
        })

    conn.close()

    print(f"Processing {len(images)} images...")

    # Process batch
    results = client.process_batch(images)

    print(f"Processed {results['images_processed']} images")
    print(f"Total characters: {results['total_characters']}")
    print(f"Processing time: {results['processing_time_ms']:.0f}ms")
    print()

    # Show results per image
    for result in results['results']:
        print(f"{result['id']}: {result['char_count']} chars - {result['text'][:50]}")


if __name__ == "__main__":
    example_usage()
