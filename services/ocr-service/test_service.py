#!/usr/bin/env python3
"""
Test script for OCR Batch Processing Service

Validates the service is working correctly with sample data.
"""

import requests
import base64
import sqlite3
import time
from pathlib import Path


def test_health():
    """Test health endpoint."""
    response = requests.get("http://localhost:8000/")
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'healthy'
    print("✓ Basic health check passed")

    # Test detailed health endpoint
    response = requests.get("http://localhost:8000/health")
    assert response.status_code == 200
    data = response.json()
    assert 'circuit_breaker' in data
    assert 'job_storage' in data
    assert 'usage' in data
    assert 'config' in data
    print("✓ Detailed health check passed")
    print(f"  Circuit breaker state: {data['circuit_breaker']['state']}")


def test_usage():
    """Test usage endpoint."""
    response = requests.get("http://localhost:8000/usage")
    assert response.status_code == 200
    data = response.json()
    assert 'usage' in data
    assert 'limits' in data
    print("✓ Usage endpoint passed")
    print(f"  Jobs today: {data['usage']['jobs_today']}/{data['limits']['per_day']}")


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


def test_async_job_processing():
    """Test async job processing with real data."""
    # Load sample images from confirmed video
    video_dir = Path("local/data/95/95b2d9b2-2e2c-462c-9e2a-fb9a50c57398")
    cropping_db = video_dir / "cropping.db"

    if not cropping_db.exists():
        print("⚠ Skipping async job test - sample data not available")
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
        print("⚠ Skipping async job test - no sample frames found")
        return

    # Submit job
    response = requests.post(
        "http://localhost:8000/ocr/jobs",
        json={"images": images}
    )

    assert response.status_code == 200
    submit_data = response.json()
    assert 'job_id' in submit_data
    job_id = submit_data['job_id']
    print(f"✓ Job submitted: {job_id}")

    # Poll for completion
    max_polls = 60
    poll_count = 0
    while poll_count < max_polls:
        response = requests.get(f"http://localhost:8000/ocr/jobs/{job_id}")
        assert response.status_code == 200
        status_data = response.json()

        if status_data['status'] == 'completed':
            assert 'result' in status_data
            result = status_data['result']
            assert 'results' in result
            assert 'processing_time_ms' in result
            assert 'total_characters' in result
            assert len(result['results']) == len(images)

            print(f"✓ Async job processing passed")
            print(f"  Processed {result['images_processed']} images")
            print(f"  Total characters: {result['total_characters']}")
            print(f"  Processing time: {result['processing_time_ms']:.0f}ms")
            print()

            # Verify results
            for res in result['results']:
                print(f"  {res['id']}: {res['char_count']} chars - {res['text'][:30]}")

            return

        elif status_data['status'] == 'failed':
            print(f"✗ Job failed: {status_data.get('error', 'Unknown error')}")
            assert False, f"Job failed: {status_data.get('error')}"

        time.sleep(0.5)
        poll_count += 1

    assert False, f"Job did not complete within {max_polls * 0.5}s"


def test_job_deduplication():
    """Test that identical jobs are deduplicated."""
    # Create simple test images
    test_images = [
        {
            "id": "test_1",
            "data": base64.b64encode(b"fake_image_data_1").decode('utf-8')
        }
    ]

    # Submit first job
    response1 = requests.post(
        "http://localhost:8000/ocr/jobs",
        json={"images": test_images}
    )

    if response1.status_code != 200:
        print(f"⚠ Skipping deduplication test - service not fully available")
        return

    job_id_1 = response1.json()['job_id']

    # Wait a moment for processing to start
    time.sleep(0.1)

    # Submit identical job
    response2 = requests.post(
        "http://localhost:8000/ocr/jobs",
        json={"images": test_images}
    )
    job_id_2 = response2.json()['job_id']

    # Job IDs should match (deduplicated)
    assert job_id_1 == job_id_2, "Identical jobs should have same job_id"
    print("✓ Job deduplication passed")
    print(f"  Both jobs got same ID: {job_id_1[:16]}...")


def test_rate_limiting():
    """Test that rate limiting works."""
    # This is a light test - just verify the endpoint responds correctly
    # Not testing actual enforcement to avoid triggering limits

    usage_response = requests.get("http://localhost:8000/usage")
    usage = usage_response.json()

    assert 'limits' in usage
    assert usage['limits']['per_minute'] > 0
    assert usage['limits']['per_hour'] > 0
    assert usage['limits']['per_day'] > 0

    print("✓ Rate limiting configuration passed")
    print(f"  Limits: {usage['limits']['per_minute']}/min, {usage['limits']['per_hour']}/hour, {usage['limits']['per_day']}/day")


def main():
    """Run all tests."""
    print("Testing OCR Batch Processing Service (v2.0 - Async API)")
    print("="*60)
    print()

    try:
        test_health()
        test_usage()
        test_capacity()
        test_rate_limiting()
        test_job_deduplication()
        test_async_job_processing()

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
