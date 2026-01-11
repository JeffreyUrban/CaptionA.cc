"""Tests for image URLs endpoint."""

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.fixture
async def image_urls_client(
    app: FastAPI,
    auth_context: AuthContext,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for image URLs endpoint."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    # Mock boto3 client
    mock_s3 = MagicMock()
    mock_s3.generate_presigned_url.return_value = "https://wasabi.example.com/signed-url"

    with patch("app.routers.videos.boto3.client", return_value=mock_s3):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


class TestGetImageUrls:
    """Tests for GET /{video_id}/image-urls endpoint."""

    async def test_get_image_urls(
        self, image_urls_client: AsyncClient, test_video_id: str
    ):
        """Should return presigned URLs for frames."""
        response = await image_urls_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": "0,10,20"}
        )
        assert response.status_code == 200

        data = response.json()
        assert "urls" in data
        assert "0" in data["urls"]
        assert "10" in data["urls"]
        assert "20" in data["urls"]

    async def test_get_image_urls_single_frame(
        self, image_urls_client: AsyncClient, test_video_id: str
    ):
        """Should handle single frame request."""
        response = await image_urls_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": "5"}
        )
        assert response.status_code == 200

        data = response.json()
        assert "5" in data["urls"]

    async def test_get_image_urls_requires_frames(
        self, image_urls_client: AsyncClient, test_video_id: str
    ):
        """Should require frames parameter."""
        response = await image_urls_client.get(f"/videos/{test_video_id}/image-urls")
        assert response.status_code == 422  # Validation error

    async def test_get_image_urls_invalid_frames(
        self, image_urls_client: AsyncClient, test_video_id: str
    ):
        """Should reject invalid frame indices."""
        response = await image_urls_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": "abc,def"}
        )
        assert response.status_code == 400

    async def test_get_image_urls_empty_frames(
        self, image_urls_client: AsyncClient, test_video_id: str
    ):
        """Should reject empty frames."""
        response = await image_urls_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": ""}
        )
        assert response.status_code == 400

    async def test_get_image_urls_max_frames(
        self, image_urls_client: AsyncClient, test_video_id: str
    ):
        """Should reject more than 100 frames."""
        frames = ",".join(str(i) for i in range(101))
        response = await image_urls_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": frames}
        )
        assert response.status_code == 400
