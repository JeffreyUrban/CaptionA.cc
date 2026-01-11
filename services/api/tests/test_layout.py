"""Tests for layout API endpoints."""

import pytest
from httpx import AsyncClient


class TestGetLayoutConfig:
    """Tests for GET /{video_id}/layout/config endpoint."""

    async def test_get_layout_config(self, layout_client: AsyncClient, test_video_id: str):
        """Should return layout config."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/config")
        assert response.status_code == 200

        data = response.json()
        assert "config" in data
        config = data["config"]
        assert config["frameWidth"] == 1920
        assert config["frameHeight"] == 1080
        assert config["cropLeft"] == 10
        assert config["cropTop"] == 20
        assert config["selectionMode"] == "manual"

    async def test_get_layout_config_not_found(
        self, layout_client_empty_db: AsyncClient, test_video_id: str
    ):
        """Should return 404 when config not initialized."""
        response = await layout_client_empty_db.get(f"/videos/{test_video_id}/layout/config")
        assert response.status_code == 404


class TestInitLayoutConfig:
    """Tests for POST /{video_id}/layout/config endpoint."""

    async def test_init_layout_config(
        self, layout_client_empty_db: AsyncClient, test_video_id: str
    ):
        """Should initialize layout config."""
        response = await layout_client_empty_db.post(
            f"/videos/{test_video_id}/layout/config",
            json={"frameWidth": 1280, "frameHeight": 720},
        )
        assert response.status_code == 201

        data = response.json()
        config = data["config"]
        assert config["frameWidth"] == 1280
        assert config["frameHeight"] == 720
        assert config["cropLeft"] == 0
        assert config["selectionMode"] == "disabled"


class TestUpdateLayoutConfig:
    """Tests for PUT /{video_id}/layout/config endpoint."""

    async def test_update_crop_bounds(self, layout_client: AsyncClient, test_video_id: str):
        """Should update crop bounds."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout/config",
            json={"cropLeft": 50, "cropTop": 60},
        )
        assert response.status_code == 200

        data = response.json()
        config = data["config"]
        assert config["cropLeft"] == 50
        assert config["cropTop"] == 60
        assert config["cropBoundsVersion"] == 2  # Incremented from 1

    async def test_update_selection_region(self, layout_client: AsyncClient, test_video_id: str):
        """Should update selection region."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout/config",
            json={
                "selectionLeft": 100,
                "selectionTop": 200,
                "selectionRight": 300,
                "selectionBottom": 400,
                "selectionMode": "auto",
            },
        )
        assert response.status_code == 200

        data = response.json()
        config = data["config"]
        assert config["selectionLeft"] == 100
        assert config["selectionMode"] == "auto"


class TestUpdateAnalysisResults:
    """Tests for PUT /{video_id}/layout/config/analysis endpoint."""

    async def test_update_analysis_results(self, layout_client: AsyncClient, test_video_id: str):
        """Should update analysis results."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout/config/analysis",
            json={
                "verticalPosition": 0.85,
                "boxHeight": 0.1,
                "anchorType": "bottom",
                "analysisModelVersion": "v1.0.0",
            },
        )
        assert response.status_code == 200

        data = response.json()
        config = data["config"]
        assert config["verticalPosition"] == 0.85
        assert config["boxHeight"] == 0.1
        assert config["anchorType"] == "bottom"
        assert config["analysisModelVersion"] == "v1.0.0"


class TestGetBoxLabels:
    """Tests for GET /{video_id}/layout/labels endpoint."""

    async def test_get_all_labels(self, layout_client: AsyncClient, test_video_id: str):
        """Should return all box labels."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/labels")
        assert response.status_code == 200

        data = response.json()
        assert "labels" in data
        assert len(data["labels"]) == 4

    async def test_get_labels_by_frame(self, layout_client: AsyncClient, test_video_id: str):
        """Should filter by frame index."""
        response = await layout_client.get(
            f"/videos/{test_video_id}/layout/labels", params={"frame": 0}
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["labels"]) == 2
        assert all(l["frameIndex"] == 0 for l in data["labels"])

    async def test_get_labels_by_source(self, layout_client: AsyncClient, test_video_id: str):
        """Should filter by label source."""
        response = await layout_client.get(
            f"/videos/{test_video_id}/layout/labels", params={"source": "user"}
        )
        assert response.status_code == 200

        data = response.json()
        assert len(data["labels"]) == 2
        assert all(l["labelSource"] == "user" for l in data["labels"])


class TestGetBoxLabel:
    """Tests for GET /{video_id}/layout/labels/{label_id} endpoint."""

    async def test_get_label_exists(self, layout_client: AsyncClient, test_video_id: str):
        """Should return label by ID."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/labels/1")
        assert response.status_code == 200

        data = response.json()
        label = data["label"]
        assert label["id"] == 1
        assert label["frameIndex"] == 0
        assert label["boxIndex"] == 0
        assert label["label"] == "in"

    async def test_get_label_not_found(self, layout_client: AsyncClient, test_video_id: str):
        """Should return 404 when label doesn't exist."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/labels/999")
        assert response.status_code == 404


class TestCreateBoxLabel:
    """Tests for POST /{video_id}/layout/labels endpoint."""

    async def test_create_box_label(self, layout_client: AsyncClient, test_video_id: str):
        """Should create a new box label."""
        response = await layout_client.post(
            f"/videos/{test_video_id}/layout/labels",
            json={"frameIndex": 10, "boxIndex": 5, "label": "in"},
        )
        assert response.status_code == 201

        data = response.json()
        label = data["label"]
        assert label["frameIndex"] == 10
        assert label["boxIndex"] == 5
        assert label["label"] == "in"
        assert label["labelSource"] == "user"  # Default

    async def test_create_box_label_model_source(
        self, layout_client: AsyncClient, test_video_id: str
    ):
        """Should create label with model source."""
        response = await layout_client.post(
            f"/videos/{test_video_id}/layout/labels",
            json={"frameIndex": 10, "boxIndex": 5, "label": "out", "labelSource": "model"},
        )
        assert response.status_code == 201

        data = response.json()
        assert data["label"]["labelSource"] == "model"


class TestCreateBoxLabelsBatch:
    """Tests for POST /{video_id}/layout/labels/batch endpoint."""

    async def test_create_batch_labels(self, layout_client: AsyncClient, test_video_id: str):
        """Should create multiple labels in batch."""
        response = await layout_client.post(
            f"/videos/{test_video_id}/layout/labels/batch",
            json={
                "labels": [
                    {"frameIndex": 10, "boxIndex": 0, "label": "in"},
                    {"frameIndex": 10, "boxIndex": 1, "label": "out"},
                    {"frameIndex": 10, "boxIndex": 2, "label": "in", "labelSource": "model"},
                ]
            },
        )
        assert response.status_code == 201

        data = response.json()
        assert data["created"] == 3
        assert len(data["labels"]) == 3


class TestDeleteBoxLabel:
    """Tests for DELETE /{video_id}/layout/labels/{label_id} endpoint."""

    async def test_delete_box_label(self, layout_client: AsyncClient, test_video_id: str):
        """Should delete a box label."""
        response = await layout_client.delete(f"/videos/{test_video_id}/layout/labels/1")
        assert response.status_code == 200

        data = response.json()
        assert data["deleted"] is True

    async def test_delete_box_label_not_found(
        self, layout_client: AsyncClient, test_video_id: str
    ):
        """Should return 404 when label doesn't exist."""
        response = await layout_client.delete(f"/videos/{test_video_id}/layout/labels/999")
        assert response.status_code == 404


class TestDeleteBoxLabelsBySource:
    """Tests for DELETE /{video_id}/layout/labels endpoint."""

    async def test_delete_labels_by_source(self, layout_client: AsyncClient, test_video_id: str):
        """Should delete all labels from a source."""
        response = await layout_client.delete(
            f"/videos/{test_video_id}/layout/labels", params={"source": "model"}
        )
        assert response.status_code == 200

        data = response.json()
        assert data["deleted"] is True

        # Verify model labels are gone
        response = await layout_client.get(
            f"/videos/{test_video_id}/layout/labels", params={"source": "model"}
        )
        assert len(response.json()["labels"]) == 0


class TestGetPreferences:
    """Tests for GET /{video_id}/layout/preferences endpoint."""

    async def test_get_preferences(self, layout_client: AsyncClient, test_video_id: str):
        """Should return video preferences."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/preferences")
        assert response.status_code == 200

        data = response.json()
        assert "preferences" in data
        assert data["preferences"]["layoutApproved"] is False


class TestUpdatePreferences:
    """Tests for PUT /{video_id}/layout/preferences endpoint."""

    async def test_update_preferences(self, layout_client: AsyncClient, test_video_id: str):
        """Should update video preferences."""
        response = await layout_client.put(
            f"/videos/{test_video_id}/layout/preferences",
            json={"layoutApproved": True},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["preferences"]["layoutApproved"] is True


class TestLayoutResponseFormat:
    """Tests for layout API response format."""

    async def test_config_uses_camel_case(self, layout_client: AsyncClient, test_video_id: str):
        """Should return config with camelCase fields."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/config")
        data = response.json()
        config = data["config"]

        # Check camelCase fields
        assert "frameWidth" in config
        assert "frameHeight" in config
        assert "cropLeft" in config
        assert "selectionMode" in config
        assert "cropBoundsVersion" in config

        # Check snake_case fields are NOT present
        assert "frame_width" not in config
        assert "crop_left" not in config

    async def test_label_uses_camel_case(self, layout_client: AsyncClient, test_video_id: str):
        """Should return labels with camelCase fields."""
        response = await layout_client.get(f"/videos/{test_video_id}/layout/labels/1")
        data = response.json()
        label = data["label"]

        assert "frameIndex" in label
        assert "boxIndex" in label
        assert "labelSource" in label
        assert "createdAt" in label

        # Check snake_case fields are NOT present
        assert "frame_index" not in label
        assert "label_source" not in label
