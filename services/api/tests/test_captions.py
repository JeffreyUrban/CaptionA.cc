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
        assert "boundaryState" in caption
        assert "boundaryPending" in caption
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
            assert caption["boundaryState"] == "gap" or caption["boundaryPending"] is True

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
                "boundaryState": "predicted",
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
        assert data["caption"]["boundaryState"] == "predicted"

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
        assert data["caption"]["boundaryState"] == "predicted"  # default

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
                "boundaryState": "gap",
            },
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["caption"]["boundaryState"] == "gap"


class TestUpdateCaption:
    """Tests for PUT /videos/{video_id}/captions/{caption_id}."""

    @pytest.mark.asyncio
    async def test_update_caption_boundaries(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should update caption boundaries."""
        response = await client.put(
            f"/videos/{test_video_id}/captions/1",
            json={
                "startFrameIndex": 10,
                "endFrameIndex": 90,
                "boundaryState": "confirmed",
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "caption" in data
        assert data["caption"]["startFrameIndex"] == 10
        assert data["caption"]["endFrameIndex"] == 90
        assert data["caption"]["boundaryState"] == "confirmed"
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
                "boundaryState": "confirmed",
            },
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_caption_overlap_resolution(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should handle overlap resolution when expanding boundaries."""
        # Expand caption 1 to overlap with caption 2
        response = await client.put(
            f"/videos/{test_video_id}/captions/1",
            json={
                "startFrameIndex": 0,
                "endFrameIndex": 150,  # Overlaps with caption 2 (101-200)
                "boundaryState": "confirmed",
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
            "boundaryState",
            "boundaryPending",
            "boundaryUpdatedAt",
            "text",
            "textPending",
            "textStatus",
            "textNotes",
            "textOcrCombined",
            "textUpdatedAt",
            "imageNeedsRegen",
            "medianOcrStatus",
            "medianOcrError",
            "medianOcrProcessedAt",
            "createdAt",
        }
        assert set(caption.keys()) == expected_keys

    @pytest.mark.asyncio
    async def test_boundary_state_enum_values(
        self, client: AsyncClient, test_video_id: str, auth_headers: dict
    ):
        """Should return valid boundary state enum values."""
        response = await client.get(
            f"/videos/{test_video_id}/captions",
            params={"start": 0, "end": 500},
            headers=auth_headers,
        )

        assert response.status_code == 200
        captions = response.json()["captions"]

        valid_states = {"predicted", "confirmed", "gap"}
        for caption in captions:
            assert caption["boundaryState"] in valid_states
