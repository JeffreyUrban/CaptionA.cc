#!/usr/bin/env python3
"""
Test script for OCR Batch Processing Service

Validates the service is working correctly with sample data.
"""

import requests
import base64
import sqlite3
from pathlib import Path


def test_health():
    """Test health endpoint."""
    response = requests.get("http://localhost:8000/")
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'healthy'
    print("✓ Health check passed")


def test_capacity():
    """Test capacity calculation."""
    response = requests.post(
        "http://localhost:8000/capacity",
        json={"width": 666, "height": 64}
    )
    assert response.status_code == 200
    data = response.json()

    assert 'max_images' in data
    assert 'limits' in data
    assert 'limiting_factor' in data

    print(f"✓ Capacity check passed")
    print(f"  Max images for 666×64: {data['max_images']}")
    print(f"  Limiting factor: {data['limiting_factor']}")


def test_batch_processing():
    """Test batch OCR processing with real data."""
    # Load sample images from confirmed video
    video_dir = Path("local/data/95/95b2d9b2-2e2c-462c-9e2a-fb9a50c57398")
    cropping_db = video_dir / "cropping.db"

    if not cropping_db.exists():
        print("⚠ Skipping batch test - sample data not available")
        return

    conn = sqlite3.connect(cropping_db)
    cursor = conn.cursor()

    # Load 5 sample frames
    cursor.execute("""
        SELECT frame_index, image_data
        FROM cropped_frames
        WHERE frame_index IN (255, 1204, 1735, 1876, 1972)
        ORDER BY frame_index
    """)

    images = []
    for frame_index, image_data in cursor.fetchall():
        images.append({
            "id": f"frame_{frame_index}",
            "data": base64.b64encode(image_data).decode('utf-8')
        })

    conn.close()

    if not images:
        print("⚠ Skipping batch test - no sample frames found")
        return

    # Process batch
    response = requests.post(
        "http://localhost:8000/ocr/batch",
        json={"images": images}
    )

    assert response.status_code == 200
    data = response.json()

    assert 'results' in data
    assert 'processing_time_ms' in data
    assert 'total_characters' in data
    assert len(data['results']) == len(images)

    print(f"✓ Batch processing passed")
    print(f"  Processed {data['images_processed']} images")
    print(f"  Total characters: {data['total_characters']}")
    print(f"  Processing time: {data['processing_time_ms']:.0f}ms")
    print()

    # Verify results
    for result in data['results']:
        print(f"  {result['id']}: {result['char_count']} chars - {result['text'][:30]}")


def main():
    """Run all tests."""
    print("Testing OCR Batch Processing Service")
    print("="*60)
    print()

    try:
        test_health()
        test_capacity()
        test_batch_processing()

        print()
        print("="*60)
        print("All tests passed! ✓")

    except requests.exceptions.ConnectionError:
        print("✗ Error: Cannot connect to service")
        print("  Make sure the service is running: python app.py")
        return 1

    except AssertionError as e:
        print(f"✗ Test failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
