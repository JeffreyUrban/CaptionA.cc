#!/usr/bin/env python3
"""
Example client for OCR Batch Processing Service

This demonstrates how to use the async job API from external orchestration code.
"""

import base64
import time
from pathlib import Path
from typing import Dict, List

import requests


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

    def submit_job(self, images: List[Dict[str, any]]) -> str:
        """
        Submit OCR job for async processing.

        Args:
            images: List of dicts with 'id' and 'data' (bytes)

        Returns:
            job_id to poll for results
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
            f"{self.base_url}/ocr/jobs",
            json=payload
        )
        response.raise_for_status()
        result = response.json()
        return result['job_id']

    def get_job_status(self, job_id: str) -> Dict:
        """
        Get job status and results.

        Returns job status dict with 'status' field.
        If status is 'completed', includes 'result' field with OCR results.
        """
        response = requests.get(f"{self.base_url}/ocr/jobs/{job_id}")
        response.raise_for_status()
        return response.json()

    def wait_for_job(self, job_id: str, poll_interval: float = 0.5, timeout: float = 60) -> Dict:
        """
        Poll job until complete or timeout.

        Args:
            job_id: Job ID to poll
            poll_interval: Seconds between polls
            timeout: Max seconds to wait

        Returns:
            Job result dict

        Raises:
            TimeoutError: If job doesn't complete in time
            RuntimeError: If job fails
        """
        start_time = time.time()

        while True:
            status = self.get_job_status(job_id)

            if status['status'] == 'completed':
                return status['result']
            elif status['status'] == 'failed':
                raise RuntimeError(f"Job failed: {status.get('error', 'Unknown error')}")

            elapsed = time.time() - start_time
            if elapsed > timeout:
                raise TimeoutError(f"Job {job_id} did not complete within {timeout}s")

            time.sleep(poll_interval)

    def process_batch(self, images: List[Dict[str, any]], timeout: float = 60) -> Dict:
        """
        Submit job and wait for results (convenience method).

        Args:
            images: List of dicts with 'id' and 'data' (bytes)
            timeout: Max seconds to wait

        Returns:
            OCR results
        """
        job_id = self.submit_job(images)
        return self.wait_for_job(job_id, timeout=timeout)

    def get_health(self) -> Dict:
        """Get service health status."""
        response = requests.get(f"{self.base_url}/health")
        response.raise_for_status()
        return response.json()

    def get_usage(self) -> Dict:
        """Get rate limit usage statistics."""
        response = requests.get(f"{self.base_url}/usage")
        response.raise_for_status()
        return response.json()


def example_usage():
    """Example: Process cropped frames from a video."""
    import sqlite3

    client = OCRServiceClient()

    # Check service health
    print("Checking service health...")
    health = client.get_health()
    print(f"Service status: {health['status']}")
    print(f"Circuit breaker: {health['circuit_breaker']['state']}")
    print()

    # Check usage
    usage = client.get_usage()
    print(f"Usage today: {usage['usage']['jobs_today']}/{usage['limits']['per_day']}")
    print()

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
            "data": image_data
        })

    conn.close()

    print(f"Processing {len(images)} images...")

    # Submit job
    job_id = client.submit_job(images)
    print(f"Job submitted: {job_id}")
    print("Polling for results...")

    # Wait for completion
    try:
        results = client.wait_for_job(job_id)

        print("✓ Job completed!")
        print(f"Processed {results['images_processed']} images")
        print(f"Total characters: {results['total_characters']}")
        print(f"Processing time: {results['processing_time_ms']:.0f}ms")
        print()

        # Show results per image
        for result in results['results']:
            print(f"{result['id']}: {result['char_count']} chars - {result['text'][:50]}")

    except TimeoutError as e:
        print(f"✗ {e}")
    except RuntimeError as e:
        print(f"✗ {e}")


if __name__ == "__main__":
    example_usage()
