"""
OCR Service Client for CaptionA.cc Orchestrator

Client for the OCR batch processing service deployed at captionacc-ocr.fly.dev
"""

import base64
import os
import time
from typing import Any

import httpx


class OCRServiceClient:
    """Client for OCR Batch Processing Service."""

    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or os.getenv("OCR_SERVICE_URL", "https://captionacc-ocr.fly.dev")

    def get_capacity(self, width: int, height: int) -> dict[str, Any]:
        """Get maximum batch size for given image dimensions."""
        response = httpx.post(
            f"{self.base_url}/capacity",
            json={"width": width, "height": height},
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()

    def submit_job(self, images: list[dict[str, Any]]) -> str:
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
                {"id": img["id"], "data": base64.b64encode(img["data"]).decode("utf-8")}
                for img in images
            ]
        }

        response = httpx.post(
            f"{self.base_url}/ocr/jobs",
            json=payload,
            timeout=60.0,  # Longer timeout for job submission
        )
        response.raise_for_status()
        result = response.json()
        return result["job_id"]

    def get_job_status(self, job_id: str) -> dict[str, Any]:
        """
        Get job status and results.

        Returns job status dict with 'status' field.
        If status is 'completed', includes 'result' field with OCR results.
        """
        response = httpx.get(
            f"{self.base_url}/ocr/jobs/{job_id}",
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()

    def wait_for_job(
        self, job_id: str, poll_interval: float = 1.0, timeout: float = 300
    ) -> dict[str, Any]:
        """
        Poll job until complete or timeout.

        Args:
            job_id: Job ID to poll
            poll_interval: Seconds between polls (default: 1s)
            timeout: Max seconds to wait (default: 300s = 5min)

        Returns:
            Job result dict

        Raises:
            TimeoutError: If job doesn't complete in time
            RuntimeError: If job fails
        """
        start_time = time.time()

        while True:
            status = self.get_job_status(job_id)

            if status["status"] == "completed":
                return status["result"]
            elif status["status"] == "failed":
                error = status.get("error", "Unknown error")
                raise RuntimeError(f"OCR job failed: {error}")

            elapsed = time.time() - start_time
            if elapsed > timeout:
                raise TimeoutError(f"OCR job {job_id} did not complete within {timeout}s")

            time.sleep(poll_interval)

    def process_batch(self, images: list[dict[str, Any]], timeout: float = 300) -> dict[str, Any]:
        """
        Submit job and wait for results (convenience method).

        Args:
            images: List of dicts with 'id' and 'data' (bytes)
            timeout: Max seconds to wait (default: 300s)

        Returns:
            OCR results dict with 'results', 'total_characters', etc.
        """
        job_id = self.submit_job(images)
        return self.wait_for_job(job_id, timeout=timeout)

    def get_health(self) -> dict[str, Any]:
        """Get service health status."""
        response = httpx.get(f"{self.base_url}/health", timeout=10.0)
        response.raise_for_status()
        return response.json()

    def get_usage(self) -> dict[str, Any]:
        """Get rate limit usage statistics."""
        response = httpx.get(f"{self.base_url}/usage", timeout=10.0)
        response.raise_for_status()
        return response.json()


def get_ocr_client() -> OCRServiceClient:
    """Get configured OCR service client."""
    return OCRServiceClient()
