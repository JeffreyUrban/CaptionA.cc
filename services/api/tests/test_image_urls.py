"""Tests for image URLs and frame chunks endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.fixture
async def videos_client(
    app: FastAPI,
    auth_context: AuthContext,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for videos endpoints."""
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


# Keep old fixture name for backwards compatibility
@pytest.fixture
async def image_urls_client(
    videos_client: AsyncClient,
) -> AsyncGenerator[AsyncClient, None]:
    """Alias for videos_client for backwards compatibility."""
    yield videos_client


class TestGetImageUrls:
    """Tests for GET /{video_id}/image-urls endpoint."""

    async def test_get_image_urls(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should return presigned URLs for frames with expiresIn."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": "0,10,20"}
        )
        assert response.status_code == 200

        data = response.json()
        assert "urls" in data
        assert "expiresIn" in data
        assert data["expiresIn"] == 900  # 15 minutes
        assert "0" in data["urls"]
        assert "10" in data["urls"]
        assert "20" in data["urls"]

    async def test_get_image_urls_single_frame(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should handle single frame request."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": "5"}
        )
        assert response.status_code == 200

        data = response.json()
        assert "5" in data["urls"]
        assert "expiresIn" in data

    async def test_get_image_urls_thumb_size(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should accept thumb size parameter (default)."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls",
            params={"frames": "0", "size": "thumb"},
        )
        assert response.status_code == 200

    async def test_get_image_urls_full_size(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should accept full size parameter."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls",
            params={"frames": "0", "size": "full"},
        )
        assert response.status_code == 200

    async def test_get_image_urls_invalid_size(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject invalid size parameter."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls",
            params={"frames": "0", "size": "invalid"},
        )
        assert response.status_code == 422  # Validation error

    async def test_get_image_urls_requires_frames(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should require frames parameter."""
        response = await videos_client.get(f"/videos/{test_video_id}/image-urls")
        assert response.status_code == 422  # Validation error

    async def test_get_image_urls_invalid_frames(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject invalid frame indices."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": "abc,def"}
        )
        assert response.status_code == 400

    async def test_get_image_urls_empty_frames(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject empty frames."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": ""}
        )
        assert response.status_code == 400

    async def test_get_image_urls_max_frames(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject more than 100 frames."""
        frames = ",".join(str(i) for i in range(101))
        response = await videos_client.get(
            f"/videos/{test_video_id}/image-urls", params={"frames": frames}
        )
        assert response.status_code == 400


class TestGetFrameChunks:
    """Tests for GET /{video_id}/frame-chunks endpoint."""

    async def test_get_frame_chunks(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should return chunk URLs with expiresIn."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 4, "indices": "0,4,8,12"},
        )
        assert response.status_code == 200

        data = response.json()
        assert "chunks" in data
        assert "expiresIn" in data
        assert data["expiresIn"] == 900
        assert len(data["chunks"]) > 0

        chunk = data["chunks"][0]
        assert "chunkIndex" in chunk
        assert "signedUrl" in chunk
        assert "frameIndices" in chunk

    async def test_get_frame_chunks_modulo_16(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should accept modulo 16."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 16, "indices": "0,16,32"},
        )
        assert response.status_code == 200

    async def test_get_frame_chunks_modulo_1(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should accept modulo 1."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 1, "indices": "1,2,3"},
        )
        assert response.status_code == 200

    async def test_get_frame_chunks_invalid_modulo(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject invalid modulo values."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 8, "indices": "0,8"},
        )
        assert response.status_code == 422  # Validation error

    async def test_get_frame_chunks_requires_modulo(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should require modulo parameter."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"indices": "0,4,8"},
        )
        assert response.status_code == 422

    async def test_get_frame_chunks_requires_indices(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should require indices parameter."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 4},
        )
        assert response.status_code == 422

    async def test_get_frame_chunks_invalid_indices(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject invalid indices."""
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 4, "indices": "abc"},
        )
        assert response.status_code == 400

    async def test_get_frame_chunks_max_indices(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should reject more than 500 indices."""
        indices = ",".join(str(i) for i in range(501))
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 1, "indices": indices},
        )
        assert response.status_code == 400

    async def test_get_frame_chunks_groups_by_chunk(
        self, videos_client: AsyncClient, test_video_id: str
    ):
        """Should group frame indices into chunks."""
        # For modulo=4, chunk_size = 32 * 4 = 128
        # Frames 0, 4, 8 should be in chunk 0
        # Frames 128, 132 should be in chunk 128
        response = await videos_client.get(
            f"/videos/{test_video_id}/frame-chunks",
            params={"modulo": 4, "indices": "0,4,8,128,132"},
        )
        assert response.status_code == 200

        data = response.json()
        chunks = data["chunks"]
        assert len(chunks) == 2  # Two chunks

        # Find chunks by index
        chunk_0 = next((c for c in chunks if c["chunkIndex"] == 0), None)
        chunk_128 = next((c for c in chunks if c["chunkIndex"] == 128), None)

        assert chunk_0 is not None
        assert chunk_128 is not None
        assert chunk_0["frameIndices"] == [0, 4, 8]
        assert chunk_128["frameIndices"] == [128, 132]
