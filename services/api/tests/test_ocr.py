"""Tests for OCR API endpoints."""

from httpx import AsyncClient


class TestListOcrDetections:
    """Tests for GET /{video_id}/ocr/detections endpoint."""

    async def test_list_detections(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return all detections."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/detections")
        assert response.status_code == 200

        data = response.json()
        assert "detections" in data
        assert "total" in data
        assert data["total"] == 7
        assert len(data["detections"]) == 7

    async def test_list_detections_by_frame(self, ocr_client: AsyncClient, test_video_id: str):
        """Should filter by frame index."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/detections", params={"frame": 0}
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["detections"]) == 2
        assert all(d["frameIndex"] == 0 for d in data["detections"])

    async def test_list_detections_with_limit(self, ocr_client: AsyncClient, test_video_id: str):
        """Should respect limit parameter."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/detections", params={"limit": 3}
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["detections"]) == 3

    async def test_list_detections_empty(
        self, ocr_client_empty_db: AsyncClient, test_video_id: str
    ):
        """Should return empty list for empty database."""
        response = await ocr_client_empty_db.get(f"/videos/{test_video_id}/ocr/detections")
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 0
        assert len(data["detections"]) == 0


class TestGetOcrDetection:
    """Tests for GET /{video_id}/ocr/detections/{detection_id} endpoint."""

    async def test_get_detection_exists(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return detection by ID."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/detections/1")
        assert response.status_code == 200

        data = response.json()
        detection = data["detection"]
        assert detection["id"] == 1
        assert detection["text"] == "Hello"
        assert detection["frameIndex"] == 0
        assert detection["confidence"] == 0.95

    async def test_get_detection_has_bbox(self, ocr_client: AsyncClient, test_video_id: str):
        """Should include bounding box."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/detections/1")
        assert response.status_code == 200

        data = response.json()
        bbox = data["detection"]["bbox"]
        assert bbox["left"] == 100
        assert bbox["top"] == 200
        assert bbox["right"] == 200
        assert bbox["bottom"] == 250

    async def test_get_detection_not_found(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return 404 when detection doesn't exist."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/detections/999")
        assert response.status_code == 404


class TestGetFrameOcr:
    """Tests for GET /{video_id}/ocr/frames/{frame_index} endpoint."""

    async def test_get_frame_ocr(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return all detections for a frame."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/frames/0")
        assert response.status_code == 200

        data = response.json()
        frame = data["frame"]
        assert frame["frameIndex"] == 0
        assert frame["totalDetections"] == 2
        assert len(frame["detections"]) == 2

    async def test_get_frame_ocr_not_found(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return 404 when frame has no OCR data."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/frames/999")
        assert response.status_code == 404


class TestListFramesWithOcr:
    """Tests for GET /{video_id}/ocr/frames endpoint."""

    async def test_list_frames(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return all frames with OCR data."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/frames")
        assert response.status_code == 200

        data = response.json()
        assert data["totalFrames"] == 4
        frame_indices = [f["frameIndex"] for f in data["frames"]]
        assert frame_indices == [0, 1, 2, 5]

    async def test_list_frames_in_range(self, ocr_client: AsyncClient, test_video_id: str):
        """Should filter by frame range."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/frames", params={"start": 1, "end": 3}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["totalFrames"] == 2
        frame_indices = [f["frameIndex"] for f in data["frames"]]
        assert frame_indices == [1, 2]

    async def test_list_frames_with_limit(self, ocr_client: AsyncClient, test_video_id: str):
        """Should respect limit parameter."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/frames", params={"limit": 2}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["totalFrames"] == 2


class TestGetDetectionsInRange:
    """Tests for GET /{video_id}/ocr/range endpoint."""

    async def test_get_range(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return detections in frame range."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/range", params={"start": 0, "end": 1}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 4  # 2 detections each in frames 0 and 1

    async def test_get_range_with_limit(self, ocr_client: AsyncClient, test_video_id: str):
        """Should respect limit parameter."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/range", params={"start": 0, "end": 2, "limit": 3}
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["detections"]) == 3


class TestSearchOcrText:
    """Tests for GET /{video_id}/ocr/search endpoint."""

    async def test_search_found(self, ocr_client: AsyncClient, test_video_id: str):
        """Should find detections with matching text."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/search", params={"q": "Hello"}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 2
        assert all("Hello" in d["text"] for d in data["detections"])

    async def test_search_case_insensitive(self, ocr_client: AsyncClient, test_video_id: str):
        """Should be case-insensitive."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/search", params={"q": "hello"}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 2

    async def test_search_partial_match(self, ocr_client: AsyncClient, test_video_id: str):
        """Should find partial matches."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/search", params={"q": "Cap"}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 1
        assert "Caption" in data["detections"][0]["text"]

    async def test_search_not_found(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return empty when no matches."""
        response = await ocr_client.get(
            f"/videos/{test_video_id}/ocr/search", params={"q": "xyz123"}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["total"] == 0


class TestGetOcrStats:
    """Tests for GET /{video_id}/ocr/stats endpoint."""

    async def test_get_stats(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return OCR statistics."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/stats")
        assert response.status_code == 200

        data = response.json()
        assert data["totalDetections"] == 7
        assert data["framesWithOcr"] == 4
        assert data["avgDetectionsPerFrame"] == 1.75

    async def test_get_stats_empty(self, ocr_client_empty_db: AsyncClient, test_video_id: str):
        """Should return zeros for empty database."""
        response = await ocr_client_empty_db.get(f"/videos/{test_video_id}/ocr/stats")
        assert response.status_code == 200

        data = response.json()
        assert data["totalDetections"] == 0
        assert data["framesWithOcr"] == 0
        assert data["avgDetectionsPerFrame"] == 0.0


class TestOcrResponseFormat:
    """Tests for OCR API response format."""

    async def test_detection_uses_camel_case(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return detection with camelCase fields."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/detections/1")
        data = response.json()
        detection = data["detection"]

        # Check camelCase fields
        assert "frameIndex" in detection
        assert "boxIndex" in detection
        assert "frameId" in detection
        assert "createdAt" in detection

        # Check snake_case fields are NOT present
        assert "frame_index" not in detection
        assert "box_index" not in detection

    async def test_bbox_structure(self, ocr_client: AsyncClient, test_video_id: str):
        """Should return bbox as nested object."""
        response = await ocr_client.get(f"/videos/{test_video_id}/ocr/detections/1")
        data = response.json()
        bbox = data["detection"]["bbox"]

        assert "left" in bbox
        assert "top" in bbox
        assert "right" in bbox
        assert "bottom" in bbox
