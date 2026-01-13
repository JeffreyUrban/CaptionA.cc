"""Integration tests for webhooks router."""

from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def mock_settings():
    """Mock application settings."""
    with patch("app.routers.webhooks.get_settings") as mock_get_settings:
        settings = Mock()
        settings.webhook_secret = "test-secret"
        settings.prefect_api_url = "http://test-prefect.com/api"
        settings.prefect_api_key = None
        mock_get_settings.return_value = settings
        yield settings


@pytest.fixture
def client():
    """Test client for API."""
    return TestClient(app)


@pytest.fixture
def mock_prefect_api():
    """Mock Prefect API responses."""
    from unittest.mock import AsyncMock

    with patch("httpx.AsyncClient") as mock_client:
        # Create async mock for the client
        mock_async_client = Mock()

        # Mock successful flow run creation
        mock_response = Mock()
        mock_response.status_code = 201
        mock_response.json.return_value = {
            "id": "flow-run-123",
            "state": {"type": "SCHEDULED"},
        }

        # Use AsyncMock for post to track calls
        mock_post = AsyncMock(return_value=mock_response)
        mock_async_client.post = mock_post

        # Setup async context manager
        async def mock_aenter(*args):
            return mock_async_client

        async def mock_aexit(*args):
            pass

        mock_client.return_value.__aenter__ = mock_aenter
        mock_client.return_value.__aexit__ = mock_aexit

        yield mock_async_client


@pytest.mark.integration
class TestWebhooksRouter:
    """Integration tests for webhooks router."""

    def test_webhook_auth_missing(self, client):
        """Test webhook without auth header."""
        response = client.post(
            "/webhooks/supabase/videos",
            json={"type": "INSERT", "table": "videos", "record": {}},
        )

        assert response.status_code == 401
        assert "Authorization" in response.json()["detail"]

    def test_webhook_auth_invalid(self, client, mock_settings):
        """Test webhook with invalid auth."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer wrong-secret"},
            json={"type": "INSERT", "table": "videos", "record": {}},
        )

        assert response.status_code == 401
        assert "Invalid webhook secret" in response.json()["detail"]

    def test_webhook_invalid_payload_missing_fields(self, client, mock_settings):
        """Test webhook with invalid payload (missing required fields)."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={"invalid": "payload"},
        )

        assert response.status_code == 400
        assert "Invalid webhook payload" in response.json()["detail"]

    def test_webhook_invalid_payload_wrong_table(self, client, mock_settings):
        """Test webhook with wrong table name."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "users",  # Wrong table
                "record": {"id": "123"},
            },
        )

        assert response.status_code == 400
        assert "Invalid table" in response.json()["detail"]

    def test_webhook_invalid_payload_missing_record_fields(self, client, mock_settings):
        """Test webhook with missing required record fields."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {"id": "video-123"},  # Missing tenant_id and storage_key
            },
        )

        assert response.status_code == 400
        assert "Missing required field" in response.json()["detail"]

    def test_webhook_non_insert_event_update(self, client, mock_settings):
        """Test webhook ignores UPDATE events."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "UPDATE",
                "table": "videos",
                "record": {"id": "video-123"},
            },
        )

        assert response.status_code == 200
        json_data = response.json()
        assert json_data["status"] == "ignored"
        assert json_data["success"] is True
        assert "UPDATE" in json_data["message"]

    def test_webhook_non_insert_event_delete(self, client, mock_settings):
        """Test webhook ignores DELETE events."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "DELETE",
                "table": "videos",
                "record": {"id": "video-123"},
            },
        )

        assert response.status_code == 200
        json_data = response.json()
        assert json_data["status"] == "ignored"
        assert json_data["success"] is True

    def test_webhook_success_premium_tier(self, client, mock_settings, mock_prefect_api):
        """Test successful webhook processing with premium tier."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                    "tenant_tier": "premium",
                    "created_at": "2024-01-01T00:00:00Z",
                },
            },
        )

        assert response.status_code == 202
        json_data = response.json()
        assert json_data["success"] is True
        assert json_data["flow_run_id"] == "flow-run-123"
        assert json_data["status"] == "accepted"

        # Verify Prefect API was called
        assert mock_prefect_api.post.called
        call_args = mock_prefect_api.post.call_args
        assert "deployments/name" in call_args[0][0]
        assert "captionacc-video-initial-processing" in call_args[0][0]

        # Verify request payload
        request_body = call_args[1]["json"]
        assert "parameters" in request_body
        assert request_body["parameters"]["video_id"] == "video-123"
        assert request_body["parameters"]["tenant_id"] == "tenant-456"
        assert request_body["parameters"]["storage_key"] == "tenant-456/videos/video-123.mp4"

        # Verify priority was calculated (premium = 70)
        assert "priority" in request_body
        assert request_body["priority"] >= 70

        # Verify tags
        assert "tags" in request_body
        tags = request_body["tags"]
        assert "tenant:tenant-456" in tags
        assert "tier:premium" in tags
        assert "trigger:webhook" in tags
        assert "event:video-insert" in tags
        assert any(tag.startswith("priority:") for tag in tags)
        assert any(tag.startswith("age-boosting:") for tag in tags)

    def test_webhook_success_free_tier(self, client, mock_settings, mock_prefect_api):
        """Test successful webhook processing with free tier."""
        from datetime import datetime, timezone

        # Use recent timestamp to avoid age boosting
        recent_time = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-456",
                    "tenant_id": "tenant-789",
                    "storage_key": "tenant-789/videos/video-456.mp4",
                    "tenant_tier": "free",
                    "created_at": recent_time,
                },
            },
        )

        assert response.status_code == 202
        json_data = response.json()
        assert json_data["success"] is True

        # Verify priority was calculated (free = 50, with minimal age boost)
        call_args = mock_prefect_api.post.call_args
        request_body = call_args[1]["json"]
        assert request_body["priority"] >= 50
        assert request_body["priority"] <= 52  # At most 2 points age boost for recent video

    def test_webhook_success_enterprise_tier(self, client, mock_settings, mock_prefect_api):
        """Test successful webhook processing with enterprise tier."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-789",
                    "tenant_id": "tenant-enterprise",
                    "storage_key": "tenant-enterprise/videos/video-789.mp4",
                    "tenant_tier": "enterprise",
                    "created_at": "2024-01-01T00:00:00Z",
                },
            },
        )

        assert response.status_code == 202
        json_data = response.json()
        assert json_data["success"] is True

        # Verify priority was calculated (enterprise = 90)
        call_args = mock_prefect_api.post.call_args
        request_body = call_args[1]["json"]
        assert request_body["priority"] >= 90

    def test_webhook_success_default_tier_when_missing(self, client, mock_settings, mock_prefect_api):
        """Test webhook defaults to free tier when tenant_tier is missing."""
        from datetime import datetime, timezone

        # Use recent timestamp to avoid age boosting
        recent_time = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-999",
                    "tenant_id": "tenant-999",
                    "storage_key": "tenant-999/videos/video-999.mp4",
                    "created_at": recent_time,
                    # No tenant_tier specified
                },
            },
        )

        assert response.status_code == 202
        json_data = response.json()
        assert json_data["success"] is True

        # Verify priority defaults to free tier (50, with minimal age boost)
        call_args = mock_prefect_api.post.call_args
        request_body = call_args[1]["json"]
        assert request_body["priority"] >= 50
        assert request_body["priority"] <= 52  # At most 2 points age boost for recent video

    def test_webhook_prefect_api_not_configured(self, client, mock_settings):
        """Test webhook fails when Prefect API is not configured."""
        mock_settings.prefect_api_url = ""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                    "created_at": "2024-01-01T00:00:00Z",
                },
            },
        )

        assert response.status_code == 503
        assert "Prefect API URL not configured" in response.json()["detail"]

    def test_webhook_prefect_api_error(self, client, mock_settings):
        """Test webhook handles Prefect API errors gracefully."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_async_client = Mock()
            mock_client.return_value.__aenter__.return_value = mock_async_client

            # Mock Prefect API error
            import httpx

            mock_response = Mock()
            mock_response.status_code = 500
            mock_response.text = "Internal server error"
            mock_async_client.post.side_effect = httpx.HTTPStatusError(
                "Server error", request=Mock(), response=mock_response
            )

            response = client.post(
                "/webhooks/supabase/videos",
                headers={"Authorization": "Bearer test-secret"},
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "created_at": "2024-01-01T00:00:00Z",
                    },
                },
            )

            assert response.status_code == 502
            assert "Failed to trigger Prefect flow" in response.json()["detail"]

    def test_webhook_prefect_api_connection_error(self, client, mock_settings):
        """Test webhook handles Prefect API connection errors."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_async_client = Mock()
            mock_client.return_value.__aenter__.return_value = mock_async_client

            # Mock connection error
            import httpx

            mock_async_client.post.side_effect = httpx.ConnectError(
                "Connection refused"
            )

            response = client.post(
                "/webhooks/supabase/videos",
                headers={"Authorization": "Bearer test-secret"},
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "created_at": "2024-01-01T00:00:00Z",
                    },
                },
            )

            assert response.status_code == 503
            assert "Failed to connect to Prefect API" in response.json()["detail"]

    def test_webhook_includes_prefect_api_key(self, client, mock_settings, mock_prefect_api):
        """Test webhook includes Prefect API key in request headers when configured."""
        mock_settings.prefect_api_key = "test-api-key"
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                    "created_at": "2024-01-01T00:00:00Z",
                },
            },
        )

        assert response.status_code == 202

        # Verify Prefect API key was included in headers
        call_args = mock_prefect_api.post.call_args
        headers = call_args[1]["headers"]
        assert "Authorization" in headers
        assert headers["Authorization"] == "Bearer test-api-key"

    def test_webhook_auth_header_malformed_no_bearer(self, client, mock_settings):
        """Test webhook with malformed auth header (no Bearer prefix)."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "test-secret"},  # Missing "Bearer" prefix
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                },
            },
        )

        assert response.status_code == 401
        assert "Invalid Authorization header format" in response.json()["detail"]

    def test_webhook_auth_header_malformed_extra_parts(self, client, mock_settings):
        """Test webhook with malformed auth header (extra parts)."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret extra"},  # Extra part
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                },
            },
        )

        assert response.status_code == 401
        assert "Invalid Authorization header format" in response.json()["detail"]
