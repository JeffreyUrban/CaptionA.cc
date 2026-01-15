"""OCR Service client and adapter for converting to ocrmac-compatible format."""

import base64
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx
from PIL import Image

from .config import OCR_SERVICE_URL


class OCRServiceError(Exception):
    """Base exception for OCR service errors."""

    pass


class OCRServiceAdapter:
    """Adapter to convert OCR service output to ocrmac format."""

    def __init__(self, service_url: str = OCR_SERVICE_URL, poll_interval: float = 0.5, timeout: int = 300):
        """Initialize OCR service adapter.

        Args:
            service_url: URL of the OCR service
            poll_interval: How often to poll for job completion (seconds)
            timeout: Maximum time to wait for job completion (seconds)
        """
        self.service_url = service_url.rstrip("/")
        self.poll_interval = poll_interval
        self.timeout = timeout

    def process_frames_batch(self, frame_paths: List[Path], language: str = "zh-Hans") -> List[Dict[str, Any]]:
        """Process batch of frames and return ocrmac-compatible format.

        Args:
            frame_paths: List of paths to frame images
            language: OCR language preference (not used by GCP Vision, kept for compatibility)

        Returns:
            List of dicts with 'image_path', 'framework', 'annotations'
            Coordinates converted to fractional, bottom-referenced

        Raises:
            OCRServiceError: If service is unavailable or processing fails
        """
        if not frame_paths:
            return []

        # Encode images to base64
        images = []
        image_dimensions = {}  # Store dimensions for coordinate conversion
        for frame_path in frame_paths:
            try:
                # Read and encode image
                with Image.open(frame_path) as img:
                    # Store dimensions
                    image_dimensions[frame_path] = (img.width, img.height)

                    # Encode to base64
                    with open(frame_path, "rb") as f:
                        image_data = base64.b64encode(f.read()).decode("utf-8")

                images.append({"id": str(frame_path), "data": image_data})

            except Exception as e:
                raise OCRServiceError(f"Failed to read image {frame_path}: {e}")

        # Submit job to OCR service
        try:
            response = httpx.post(f"{self.service_url}/ocr/jobs", json={"images": images}, timeout=30)
            response.raise_for_status()
            job_data = response.json()
            job_id = job_data["job_id"]

        except httpx.HTTPError as e:
            raise OCRServiceError(f"Failed to submit OCR job: {e}")

        # Poll for job completion
        start_time = time.time()
        while time.time() - start_time < self.timeout:
            try:
                response = httpx.get(f"{self.service_url}/ocr/jobs/{job_id}", timeout=10)
                response.raise_for_status()
                status_data = response.json()

                if status_data["status"] == "completed":
                    # Job completed successfully
                    results = status_data["result"]["results"]
                    return self._convert_results_to_ocrmac_format(results, image_dimensions, frame_paths)

                elif status_data["status"] == "failed":
                    error = status_data.get("error", "Unknown error")
                    raise OCRServiceError(f"OCR job failed: {error}")

                # Job still processing, wait and retry
                time.sleep(self.poll_interval)

            except httpx.HTTPError as e:
                raise OCRServiceError(f"Failed to check job status: {e}")

        # Timeout
        raise OCRServiceError(f"OCR job timed out after {self.timeout} seconds (job_id: {job_id})")

    def _convert_results_to_ocrmac_format(
        self,
        results: List[Dict],
        image_dimensions: Dict[Path, Tuple[int, int]],
        frame_paths: List[Path],
    ) -> List[Dict[str, Any]]:
        """Convert OCR service results to ocrmac-compatible format.

        Args:
            results: List of OCR results from service
            image_dimensions: Dict mapping frame paths to (width, height)
            frame_paths: Original list of frame paths (for ordering)

        Returns:
            List of ocrmac-compatible result dicts
        """
        # Create a mapping from path string to result
        results_by_id = {result["id"]: result for result in results}

        ocrmac_results = []
        for frame_path in frame_paths:
            path_str = str(frame_path)
            result = results_by_id.get(path_str)

            if not result:
                # Frame not found in results (should not happen)
                ocrmac_results.append(
                    {
                        "image_path": str(frame_path.relative_to(frame_path.parent.parent)),
                        "framework": "livetext",
                        "annotations": [],
                        "error": "not_found_in_results",
                    }
                )
                continue

            # Get image dimensions
            width, height = image_dimensions[frame_path]

            # Convert characters to ocrmac annotation format
            annotations = self._convert_to_ocrmac_format(result, width, height)

            ocrmac_results.append(
                {
                    "image_path": str(frame_path.relative_to(frame_path.parent.parent)),
                    "framework": "livetext",
                    "annotations": annotations,
                }
            )

        return ocrmac_results

    def _convert_to_ocrmac_format(
        self, ocr_result: Dict, image_width: int, image_height: int
    ) -> List[Tuple[str, float, List[float]]]:
        """Convert OCR service output to ocrmac annotation format.

        OCR service provides:
        - Pixel coordinates (x, y, width, height)
        - Top-referenced y coordinate (0 = top)

        ocrmac format expects:
        - Fractional coordinates [0-1]
        - Bottom-referenced y coordinate (0 = bottom, 1 = top)
        - Format: [text, confidence, [x, y, w, h]]

        Args:
            ocr_result: OCR result for a single image
            image_width: Image width in pixels
            image_height: Image height in pixels

        Returns:
            List of [text, confidence, [x_frac, y_frac, w_frac, h_frac]] tuples
        """
        annotations = []

        for char_result in ocr_result.get("characters", []):
            text = char_result["text"]
            bbox = char_result["bbox"]

            # Extract pixel coordinates
            x_pixel = bbox["x"]
            y_pixel = bbox["y"]
            width_pixel = bbox["width"]
            height_pixel = bbox["height"]

            # Convert to fractional coordinates
            x_frac = x_pixel / image_width
            width_frac = width_pixel / image_width
            height_frac = height_pixel / image_height

            # Convert from top-referenced to bottom-referenced
            # In top-referenced: y=0 is top, y increases downward
            # In bottom-referenced: y=0 is bottom, y increases upward
            # Bottom of character in top-ref: y_pixel + height_pixel
            # Convert to bottom-ref: y_frac = 1 - (y_pixel + height_pixel) / image_height
            y_frac = 1.0 - (y_pixel + height_pixel) / image_height

            # GCP Vision doesn't provide character-level confidence, use 1.0
            confidence = 1.0

            # Create annotation in ocrmac format
            annotations.append([text, confidence, [x_frac, y_frac, width_frac, height_frac]])

        return annotations

    def calculate_batch_size(self, width: int, height: int) -> int:
        """Calculate optimal batch size for given frame dimensions.

        Queries OCR service /capacity endpoint to determine maximum
        number of images that can be safely processed in one batch.

        Args:
            width: Frame width in pixels
            height: Frame height in pixels

        Returns:
            Maximum number of frames per batch

        Raises:
            OCRServiceError: If capacity check fails
        """
        try:
            response = httpx.post(
                f"{self.service_url}/capacity",
                json={"width": width, "height": height},
                timeout=10,
            )
            response.raise_for_status()
            capacity_data = response.json()
            return capacity_data["max_images"]

        except httpx.HTTPError as e:
            # If capacity check fails, use conservative default
            print(f"Warning: Failed to check capacity: {e}")
            return 50  # Conservative default

    def health_check(self) -> bool:
        """Check if OCR service is available and healthy.

        Returns:
            True if service is healthy, False otherwise
        """
        try:
            response = httpx.get(f"{self.service_url}/health", timeout=5)
            if response.is_success:
                data = response.json()
                return data.get("status") == "healthy"
            return False
        except httpx.HTTPError:
            return False
