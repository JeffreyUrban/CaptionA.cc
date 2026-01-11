"""Tests for /preferences endpoint."""

from httpx import AsyncClient


class TestGetPreferences:
    """Tests for GET /{video_id}/preferences endpoint."""

    async def test_get_preferences(self, preferences_client: AsyncClient, test_video_id: str):
        """Should return preferences."""
        response = await preferences_client.get(f"/videos/{test_video_id}/preferences")
        assert response.status_code == 200

        data = response.json()
        assert "preferences" in data
        assert "layoutApproved" in data["preferences"]
        assert data["preferences"]["layoutApproved"] is False


class TestUpdatePreferences:
    """Tests for PUT /{video_id}/preferences endpoint."""

    async def test_update_preferences(self, preferences_client: AsyncClient, test_video_id: str):
        """Should update preferences."""
        response = await preferences_client.put(
            f"/videos/{test_video_id}/preferences",
            json={"layoutApproved": True},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["preferences"]["layoutApproved"] is True

    async def test_update_preferences_false(
        self, preferences_client: AsyncClient, test_video_id: str
    ):
        """Should update preferences to false."""
        # First set to true
        await preferences_client.put(
            f"/videos/{test_video_id}/preferences",
            json={"layoutApproved": True},
        )

        # Then set back to false
        response = await preferences_client.put(
            f"/videos/{test_video_id}/preferences",
            json={"layoutApproved": False},
        )
        assert response.status_code == 200
        assert response.json()["preferences"]["layoutApproved"] is False
