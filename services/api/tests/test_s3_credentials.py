"""Tests for S3 credentials endpoint."""

from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext
from app.models.sync import S3CredentialsInfo, S3CredentialsResponse
from app.services.sts_credentials import STSCredentialsError


@pytest.fixture
async def credentials_client(
    app: FastAPI,
    auth_context: AuthContext,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for credentials endpoint."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


class TestGetS3Credentials:
    """Tests for GET /s3-credentials endpoint."""

    async def test_success(
        self,
        credentials_client: AsyncClient,
        test_tenant_id: str,
    ):
        """Test successful S3 credentials retrieval."""
        mock_response = S3CredentialsResponse(
            credentials=S3CredentialsInfo(
                access_key_id="ASIA123456",
                secret_access_key="secret123",
                session_token="token123",
            ),
            expiration=datetime(2026, 1, 11, 12, 0, 0, tzinfo=timezone.utc),
            bucket="caption-acc-prod",
            region="us-east-1",
            endpoint="https://s3.us-east-1.wasabisys.com",
            prefix=f"{test_tenant_id}/videos/*/client/",
        )

        with patch(
            "app.routers.credentials.get_sts_service"
        ) as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_credentials.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = await credentials_client.get("/s3-credentials")

        assert response.status_code == 200
        data = response.json()
        assert data["bucket"] == "caption-acc-prod"
        assert data["region"] == "us-east-1"
        assert data["endpoint"] == "https://s3.us-east-1.wasabisys.com"
        assert data["prefix"] == f"{test_tenant_id}/videos/*/client/"
        assert "credentials" in data
        assert data["credentials"]["access_key_id"] == "ASIA123456"
        assert data["credentials"]["secret_access_key"] == "secret123"
        assert data["credentials"]["session_token"] == "token123"

    async def test_service_unavailable(
        self,
        credentials_client: AsyncClient,
    ):
        """Test that 503 is returned when STS service fails."""
        with patch(
            "app.routers.credentials.get_sts_service"
        ) as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_credentials.side_effect = STSCredentialsError(
                "STS not configured"
            )
            mock_get_service.return_value = mock_service

            response = await credentials_client.get("/s3-credentials")

        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"].lower()

    async def test_requires_auth(self, app: FastAPI):
        """Test that unauthenticated requests are rejected."""
        # Don't override auth dependency - should fail
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/s3-credentials")

        # Should be 401, 403, or 422 (when auth dependency can't resolve)
        assert response.status_code in [401, 403, 422]
