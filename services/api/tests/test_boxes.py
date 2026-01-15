"""Tests for consolidated /boxes endpoint."""

from httpx import AsyncClient


class TestGetBoxes:
    """Tests for GET /{video_id}/boxes endpoint."""

    async def test_get_boxes_with_labels(
        self, boxes_client: AsyncClient, test_video_id: str
    ):
        """Should return boxes with merged OCR and label data."""
        response = await boxes_client.get(
            f"/videos/{test_video_id}/boxes", params={"frame": 0}
        )
        assert response.status_code == 200

        data = response.json()
        frame = data["frame"]
        assert frame["frameIndex"] == 0
        assert frame["totalBoxes"] == 2

        # Check first box has user label
        box0 = frame["boxes"][0]
        assert box0["boxIndex"] == 0
        assert box0["text"] == "Hello"
        assert box0["userLabel"] == "in"
        assert box0["modelPrediction"] is None

        # Check second box has user label
        box1 = frame["boxes"][1]
        assert box1["boxIndex"] == 1
        assert box1["text"] == "World"
        assert box1["userLabel"] == "out"

    async def test_get_boxes_with_model_predictions(
        self, boxes_client: AsyncClient, test_video_id: str
    ):
        """Should return model predictions when no user labels."""
        response = await boxes_client.get(
            f"/videos/{test_video_id}/boxes", params={"frame": 1}
        )
        assert response.status_code == 200

        data = response.json()
        frame = data["frame"]
        assert frame["frameIndex"] == 1

        # Frame 1 has model predictions, not user labels
        box0 = frame["boxes"][0]
        assert box0["userLabel"] is None
        assert box0["modelPrediction"] == "in"

        box1 = frame["boxes"][1]
        assert box1["userLabel"] is None
        assert box1["modelPrediction"] == "out"

    async def test_get_boxes_without_layout_db(
        self, boxes_client_no_labels: AsyncClient, test_video_id: str
    ):
        """Should return boxes without labels when layout db doesn't exist."""
        response = await boxes_client_no_labels.get(
            f"/videos/{test_video_id}/boxes", params={"frame": 0}
        )
        assert response.status_code == 200

        data = response.json()
        frame = data["frame"]
        assert frame["totalBoxes"] == 2

        # No labels should be present
        for box in frame["boxes"]:
            assert box["userLabel"] is None
            assert box["modelPrediction"] is None

    async def test_get_boxes_includes_bbox(
        self, boxes_client: AsyncClient, test_video_id: str
    ):
        """Should include bounding box data."""
        response = await boxes_client.get(
            f"/videos/{test_video_id}/boxes", params={"frame": 0}
        )
        assert response.status_code == 200

        data = response.json()
        box = data["frame"]["boxes"][0]
        assert "bbox" in box
        assert box["bbox"]["left"] == 100
        assert box["bbox"]["top"] == 200
        assert box["bbox"]["right"] == 200
        assert box["bbox"]["bottom"] == 250

    async def test_get_boxes_frame_not_found(
        self, boxes_client: AsyncClient, test_video_id: str
    ):
        """Should return 404 when frame has no OCR data."""
        response = await boxes_client.get(
            f"/videos/{test_video_id}/boxes", params={"frame": 999}
        )
        assert response.status_code == 404

    async def test_get_boxes_requires_frame_param(
        self, boxes_client: AsyncClient, test_video_id: str
    ):
        """Should require frame parameter."""
        response = await boxes_client.get(f"/videos/{test_video_id}/boxes")
        assert response.status_code == 422  # Validation error


class TestUpdateBoxes:
    """Tests for PUT /{video_id}/boxes endpoint."""

    async def test_update_boxes(self, boxes_client: AsyncClient, test_video_id: str):
        """Should update box annotations."""
        response = await boxes_client.put(
            f"/videos/{test_video_id}/boxes",
            params={"frame": 2},
            json={
                "annotations": [
                    {"boxIndex": 0, "status": "in"},
                    {"boxIndex": 1, "status": "out"},
                ]
            },
        )
        assert response.status_code == 200

        data = response.json()
        assert data["updated"] == 2
        assert data["frame"]["frameIndex"] == 2

    async def test_update_single_box(
        self, boxes_client: AsyncClient, test_video_id: str
    ):
        """Should update a single box."""
        response = await boxes_client.put(
            f"/videos/{test_video_id}/boxes",
            params={"frame": 2},
            json={"annotations": [{"boxIndex": 0, "status": "out"}]},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["updated"] == 1
