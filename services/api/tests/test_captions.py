"""Tests for captions CRUD endpoints."""

import pytest
from httpx import AsyncClient


class TestGetCaptions:
    """Tests for GET /videos/{video_id}/captions."""

    @pytest.mark.asyncio
    async def test_get_captions_in_range(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return captions overlapping the specified frame range."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 0, "end": 200},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "captions" in data
        assert len(data["captions"]) == 2  # Captions 1 and 2 overlap [0, 200]

        # Verify caption structure
        caption = data["captions"][0]
        assert "id" in caption
        assert "startFrameIndex" in caption
        assert "endFrameIndex" in caption
        assert "captionFrameExtentsState" in caption
        assert "captionFrameExtentsPending" in caption
        assert "text" in caption

    @pytest.mark.asyncio
    async def test_get_captions_all(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return all captions when range covers everything."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 0, "end": 500},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["captions"]) == 4

    @pytest.mark.asyncio
    async def test_get_captions_workable_only(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return only gaps and pending captions when workable=true."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 0, "end": 500, "workable": True},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        # Caption 2 is pending, Caption 3 is a gap
        assert len(data["captions"]) == 2
        for caption in data["captions"]:
            assert caption["captionFrameExtentsState"] == "gap" or caption["captionFrameExtentsPending"] is True

    @pytest.mark.asyncio
    async def test_get_captions_with_limit(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should respect the limit parameter."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 0, "end": 500, "limit": 2},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["captions"]) == 2

    @pytest.mark.asyncio
    async def test_get_captions_empty_range(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return empty list when no captions in range."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 1000, "end": 2000},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["captions"]) == 0


class TestGetCaption:
    """Tests for GET /videos/{video_id}/captions/{caption_id}."""

    @pytest.mark.asyncio
    async def test_get_caption_exists(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return a single caption by ID."""
        response = await client.get(
            f"/videos/{test_video_id}/captions/1",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "caption" in data
        assert data["caption"]["id"] == 1
        assert data["caption"]["startFrameIndex"] == 0
        assert data["caption"]["endFrameIndex"] == 100
        assert data["caption"]["text"] == "First caption"

    @pytest.mark.asyncio
    async def test_get_caption_not_found(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return 404 when caption doesn't exist."""
        response = await client.get(
            f"/videos/{test_video_id}/captions/999",
            headers=auth_headers,
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


class TestCreateCaption:
    """Tests for POST /videos/{video_id}/captions."""

    @pytest.mark.asyncio
    async def test_create_caption(
        self, client_empty_db: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should create a new caption."""
        response = await client_empty_db.post(
            f"/videos/{test_video_id}/captions",
            json={
                "startFrameIndex": 0,
                "endFrameIndex": 50,
                "captionFrameExtentsState": "predicted",
                "text": "New caption",
            },
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert "caption" in data
        assert data["caption"]["startFrameIndex"] == 0
        assert data["caption"]["endFrameIndex"] == 50
        assert data["caption"]["text"] == "New caption"
        assert data["caption"]["captionFrameExtentsState"] == "predicted"

    @pytest.mark.asyncio
    async def test_create_caption_minimal(
        self, client_empty_db: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should create a caption with minimal required fields."""
        response = await client_empty_db.post(
            f"/videos/{test_video_id}/captions",
            json={
                "startFrameIndex": 100,
                "endFrameIndex": 200,
            },
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["caption"]["startFrameIndex"] == 100
        assert data["caption"]["endFrameIndex"] == 200
        assert data["caption"]["captionFrameExtentsState"] == "predicted"  # default

    @pytest.mark.asyncio
    async def test_create_gap_caption(
        self, client_empty_db: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should create a gap caption."""
        response = await client_empty_db.post(
            f"/videos/{test_video_id}/captions",
            json={
                "startFrameIndex": 0,
                "endFrameIndex": 50,
                "captionFrameExtentsState": "gap",
            },
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["caption"]["captionFrameExtentsState"] == "gap"


class TestUpdateCaption:
    """Tests for PUT /videos/{video_id}/captions/{caption_id}."""

    @pytest.mark.asyncio
    async def test_update_caption_frame_extents(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should update caption frame extents."""
        response = await client.put(
            f"/videos/{test_video_id}/captions/1",
            json={
                "startFrameIndex": 10,
                "endFrameIndex": 90,
                "captionFrameExtentsState": "confirmed",
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "caption" in data
        assert data["caption"]["startFrameIndex"] == 10
        assert data["caption"]["endFrameIndex"] == 90
        assert data["caption"]["captionFrameExtentsState"] == "confirmed"
        # Should have created gap for uncovered range [0, 9]
        assert "createdGaps" in data

    @pytest.mark.asyncio
    async def test_update_caption_not_found(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return 404 when caption doesn't exist."""
        response = await client.put(
            f"/videos/{test_video_id}/captions/999",
            json={
                "startFrameIndex": 0,
                "endFrameIndex": 50,
                "captionFrameExtentsState": "confirmed",
            },
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_caption_overlap_resolution(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should handle overlap resolution when expanding caption frame extents."""
        # Expand caption 1 to overlap with caption 2
        response = await client.put(
            f"/videos/{test_video_id}/captions/1",
            json={
                "startFrameIndex": 0,
                "endFrameIndex": 150,  # Overlaps with caption 2 (101-200)
                "captionFrameExtentsState": "confirmed",
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["caption"]["endFrameIndex"] == 150
        # Caption 2 should have been modified (trimmed)
        assert "modifiedCaptions" in data


class TestUpdateCaptionText:
    """Tests for PUT /videos/{video_id}/captions/{caption_id}/text."""

    @pytest.mark.asyncio
    async def test_update_caption_text(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should update caption text."""
        response = await client.put(
            f"/videos/{test_video_id}/captions/2/text",
            json={
                "text": "Updated caption text",
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["caption"]["text"] == "Updated caption text"
        assert data["caption"]["textPending"] is False

    @pytest.mark.asyncio
    async def test_update_caption_text_with_status(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should update caption text with status and notes."""
        response = await client.put(
            f"/videos/{test_video_id}/captions/2/text",
            json={
                "text": "Caption with status",
                "textStatus": "valid_caption",
                "textNotes": "Reviewed and approved",
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["caption"]["text"] == "Caption with status"
        assert data["caption"]["textStatus"] == "valid_caption"
        assert data["caption"]["textNotes"] == "Reviewed and approved"

    @pytest.mark.asyncio
    async def test_update_caption_text_not_found(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return 404 when caption doesn't exist."""
        response = await client.put(
            f"/videos/{test_video_id}/captions/999/text",
            json={
                "text": "Some text",
            },
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestDeleteCaption:
    """Tests for DELETE /videos/{video_id}/captions/{caption_id}."""

    @pytest.mark.asyncio
    async def test_delete_caption(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should delete a caption."""
        response = await client.delete(
            f"/videos/{test_video_id}/captions/1",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] is True

        # Verify it's gone
        response = await client.get(
            f"/videos/{test_video_id}/captions/1",
            headers=auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_caption_not_found(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return 404 when caption doesn't exist."""
        response = await client.delete(
            f"/videos/{test_video_id}/captions/999",
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestBatchCaptions:
    """Tests for POST /videos/{video_id}/captions/batch."""

    @pytest.mark.asyncio
    async def test_batch_create(
        self, client_empty_db: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should create captions in batch."""
        response = await client_empty_db.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "create",
                        "data": {
                            "startFrameIndex": 0,
                            "endFrameIndex": 100,
                            "text": "Caption 1",
                        },
                    },
                    {
                        "op": "create",
                        "data": {
                            "startFrameIndex": 100,
                            "endFrameIndex": 200,
                            "text": "Caption 2",
                        },
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["results"]) == 2
        assert data["results"][0]["op"] == "create"
        assert data["results"][1]["op"] == "create"
        # IDs should be assigned
        assert data["results"][0]["id"] is not None
        assert data["results"][1]["id"] is not None

    @pytest.mark.asyncio
    async def test_batch_update(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should update captions in batch."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "update",
                        "id": 1,
                        "data": {"text": "Updated caption 1"},
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["results"]) == 1
        assert data["results"][0]["op"] == "update"
        assert data["results"][0]["id"] == 1

    @pytest.mark.asyncio
    async def test_batch_delete(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should delete captions in batch."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {"op": "delete", "id": 4},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["results"]) == 1
        assert data["results"][0]["op"] == "delete"

    @pytest.mark.asyncio
    async def test_batch_mixed_operations(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should handle mixed create/update/delete operations."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "create",
                        "data": {
                            "startFrameIndex": 500,
                            "endFrameIndex": 600,
                            "text": "New caption",
                        },
                    },
                    {
                        "op": "update",
                        "id": 1,
                        "data": {"text": "Modified"},
                    },
                    {"op": "delete", "id": 4},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["results"]) == 3
        assert data["results"][0]["op"] == "create"
        assert data["results"][1]["op"] == "update"
        assert data["results"][2]["op"] == "delete"

    @pytest.mark.asyncio
    async def test_batch_empty_operations(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return success for empty operations list."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={"operations": []},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["results"] == []

    @pytest.mark.asyncio
    async def test_batch_create_missing_data(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when create operation missing data."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {"op": "create"},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert data["error"]["op"] == "create"
        assert "data" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_batch_create_invalid_frame_indices(
        self, client_empty_db: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when startFrameIndex >= endFrameIndex."""
        response = await client_empty_db.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "create",
                        "data": {
                            "startFrameIndex": 100,
                            "endFrameIndex": 50,  # Invalid: end < start
                        },
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert "greater than" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_batch_create_negative_frame_index(
        self, client_empty_db: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when frame index is negative."""
        response = await client_empty_db.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "create",
                        "data": {
                            "startFrameIndex": -10,
                            "endFrameIndex": 50,
                        },
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "non-negative" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_batch_update_missing_id(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when update operation missing id."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "update",
                        "data": {"text": "New text"},
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert "'id'" in data["error"]["message"]

    @pytest.mark.asyncio
    async def test_batch_update_missing_data(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when update operation missing data."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {"op": "update", "id": 1},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert "'data'" in data["error"]["message"]

    @pytest.mark.asyncio
    async def test_batch_update_not_found(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when updating non-existent caption."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "update",
                        "id": 999,
                        "data": {"text": "New text"},
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert "not found" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_batch_delete_missing_id(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when delete operation missing id."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {"op": "delete"},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert "'id'" in data["error"]["message"]

    @pytest.mark.asyncio
    async def test_batch_delete_not_found(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should fail when deleting non-existent caption."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {"op": "delete", "id": 999},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 0
        assert "not found" in data["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_batch_fails_at_second_operation(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should report correct index when later operation fails."""
        response = await client.post(
            f"/videos/{test_video_id}/captions/batch",
            json={
                "operations": [
                    {
                        "op": "update",
                        "id": 1,
                        "data": {"text": "Valid update"},
                    },
                    {
                        "op": "delete",
                        "id": 999,  # Non-existent
                    },
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert data["error"]["index"] == 1  # Second operation
        assert data["error"]["op"] == "delete"


class TestCaptionResponseFormat:
    """Tests for caption response format consistency."""

    @pytest.mark.asyncio
    async def test_caption_uses_camel_case(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should use camelCase for all caption fields."""
        response = await client.get(
            f"/videos/{test_video_id}/captions/1",
            headers=auth_headers,
        )

        assert response.status_code == 200
        caption = response.json()["caption"]

        # Verify camelCase keys
        expected_keys = {
            "id",
            "startFrameIndex",
            "endFrameIndex",
            "captionFrameExtentsState",
            "captionFrameExtentsPending",
            "captionFrameExtentsUpdatedAt",
            "text",
            "textPending",
            "textStatus",
            "textNotes",
            "captionOcr",
            "textUpdatedAt",
            "imageNeedsRegen",
            "captionOcrStatus",
            "captionOcrError",
            "captionOcrProcessedAt",
            "createdAt",
        }
        assert set(caption.keys()) == expected_keys

    @pytest.mark.asyncio
    async def test_caption_frame_extents_state_enum_values(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return valid caption frame extents state enum values."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 0, "end": 500},
            headers=auth_headers,
        )

        assert response.status_code == 200
        captions = response.json()["captions"]

        valid_states = {"predicted", "confirmed", "gap"}
        for caption in captions:
            assert caption["captionFrameExtentsState"] in valid_states
