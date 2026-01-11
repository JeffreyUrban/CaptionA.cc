"""Tests for consolidated /layout endpoint."""

from httpx import AsyncClient


class TestGetLayout:
    """Tests for GET /{video_id}/layout endpoint."""

    async def test_get_layout(self, layout_client: AsyncClient, test_video_id: str):
        """Should return consolidated layout data."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout")
        assert response.status_code == 200

        data = response.json()
        layout = data["layout"]

        # Check frame dimensions
        assert layout["frameWidth"] == 1920
        assert layout["frameHeight"] == 1080

        # Check crop bounds structure
        assert "cropBounds" in layout
        assert layout["cropBounds"]["left"] == 10
        assert layout["cropBounds"]["top"] == 20
        assert layout["cropBounds"]["right"] == 30
        assert layout["cropBounds"]["bottom"] == 40

        # Check selection mode
        assert layout["selectionMode"] == "manual"

        # Check version tracking
        assert layout["cropBoundsVersion"] == 1

    async def test_get_layout_not_initialized(
        self, layout_client_empty_db: AsyncClient, test_video_id: str
    ):
        """Should return 404 when layout not initialized."""
        response = await layout_client_empty_db.get(f"/videos/{test_video_id}/layout")
        assert response.status_code == 404


class TestUpdateLayout:
    """Tests for PUT /{video_id}/layout endpoint."""

    async def test_update_crop_bounds(self, layout_client: AsyncClient, test_video_id: str):
        """Should update crop bounds."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout",
            json={
                "cropBounds": {"left": 50, "top": 60, "right": 70, "bottom": 80}
            },
        )
        assert response.status_code == 200

        data = response.json()
        layout = data["layout"]
        assert layout["cropBounds"]["left"] == 50
        assert layout["cropBounds"]["top"] == 60
        assert layout["cropBounds"]["right"] == 70
        assert layout["cropBounds"]["bottom"] == 80

    async def test_update_selection_bounds(self, layout_client: AsyncClient, test_video_id: str):
        """Should update selection bounds."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout",
            json={
                "selectionBounds": {"left": 100, "top": 100, "right": 500, "bottom": 300}
            },
        )
        assert response.status_code == 200

        data = response.json()
        layout = data["layout"]
        assert layout["selectionBounds"]["left"] == 100
        assert layout["selectionBounds"]["right"] == 500

    async def test_update_selection_mode(self, layout_client: AsyncClient, test_video_id: str):
        """Should update selection mode."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout",
            json={"selectionMode": "auto"},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["layout"]["selectionMode"] == "auto"

    async def test_update_layout_params(self, layout_client: AsyncClient, test_video_id: str):
        """Should update layout analysis parameters."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout",
            json={
                "layoutParams": {
                    "verticalPosition": 0.85,
                    "boxHeight": 50.0,
                    "analysisModelVersion": "v2.0"
                }
            },
        )
        assert response.status_code == 200

        data = response.json()
        layout = data["layout"]
        assert layout["layoutParams"]["verticalPosition"] == 0.85
        assert layout["layoutParams"]["boxHeight"] == 50.0
        assert layout["layoutParams"]["analysisModelVersion"] == "v2.0"


class TestInitLayout:
    """Tests for POST /{video_id}/layout endpoint."""

    async def test_init_layout(self, layout_client_empty_db: AsyncClient, test_video_id: str):
        """Should initialize layout with frame dimensions."""
        response = await layout_client_empty_db.post(
            f"/videos/{test_video_id}/layout",
            json={"frameWidth": 1280, "frameHeight": 720},
        )
        assert response.status_code == 201

        data = response.json()
        layout = data["layout"]
        assert layout["frameWidth"] == 1280
        assert layout["frameHeight"] == 720
        assert layout["cropBoundsVersion"] == 1
