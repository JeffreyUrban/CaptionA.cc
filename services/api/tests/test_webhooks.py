"""Tests for webhook endpoints."""

from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.fixture
async def webhook_client(app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for webhook endpoints (no auth override)."""
    # Webhook endpoints use header-based auth, not JWT
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestWebhookAuthentication:
    """Tests for webhook authentication validation."""

    async def test_missing_authorization_header(self, webhook_client: AsyncClient):
        """Should reject request without Authorization header."""
        response = await webhook_client.post(
            "/webhooks/supabase/videos",
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
        assert "Missing Authorization header" in response.json()["detail"]

    async def test_invalid_authorization_format(self, webhook_client: AsyncClient):
        """Should reject invalid Authorization header format."""
        response = await webhook_client.post(
            "/webhooks/supabase/videos",
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                },
            },
            headers={"Authorization": "InvalidFormat token123"},
        )
        assert response.status_code == 401
        assert "Invalid Authorization header format" in response.json()["detail"]

    async def test_missing_bearer_prefix(self, webhook_client: AsyncClient):
        """Should reject Authorization header without Bearer prefix."""
        response = await webhook_client.post(
            "/webhooks/supabase/videos",
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "tenant-456/videos/video-123.mp4",
                },
            },
            headers={"Authorization": "wrong-secret"},
        )
        assert response.status_code == 401

    async def test_invalid_webhook_secret(self, webhook_client: AsyncClient):
        """Should reject request with incorrect webhook secret."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "correct-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                    },
                },
                headers={"Authorization": "Bearer wrong-secret"},
            )
            assert response.status_code == 401
            assert "Invalid webhook secret" in response.json()["detail"]

    async def test_valid_webhook_secret(self, webhook_client: AsyncClient):
        """Should accept request with correct webhook secret."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200


class TestWebhookPayloadValidation:
    """Tests for webhook payload validation."""

    async def test_invalid_json_payload(self, webhook_client: AsyncClient):
        """Should reject invalid JSON payload."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                content="invalid json",
                headers={
                    "Authorization": "Bearer test-secret",
                    "Content-Type": "application/json",
                },
            )
            assert response.status_code == 400

    async def test_missing_required_fields(self, webhook_client: AsyncClient):
        """Should reject payload missing required fields."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    # Missing "table" and "record"
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 400
            assert "Invalid webhook payload" in response.json()["detail"]

    async def test_invalid_table_name(self, webhook_client: AsyncClient):
        """Should reject payload with wrong table name."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "wrong_table",
                    "record": {"id": "123"},
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 400
            assert "Invalid table" in response.json()["detail"]
            assert "videos" in response.json()["detail"]

    async def test_missing_video_id(self, webhook_client: AsyncClient):
        """Should reject record without video ID."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        # Missing "id"
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video.mp4",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 400
            assert "Missing required field" in response.json()["detail"]

    async def test_missing_tenant_id(self, webhook_client: AsyncClient):
        """Should reject record without tenant ID."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        # Missing "tenant_id"
                        "storage_key": "tenant-456/videos/video.mp4",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 400
            assert "Missing required field" in response.json()["detail"]

    async def test_missing_storage_key(self, webhook_client: AsyncClient):
        """Should reject record without storage key."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        # Missing "storage_key"
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 400
            assert "Missing required field" in response.json()["detail"]


class TestWebhookEventTypes:
    """Tests for different webhook event types."""

    async def test_update_event_ignored(self, webhook_client: AsyncClient):
        """Should ignore UPDATE events."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "UPDATE",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                    },
                    "old_record": {"status": "uploading"},
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            data = response.json()
            assert data["success"] is True
            assert data["status"] == "ignored"
            assert data["flow_run_id"] is None
            assert "not handled" in data["message"]

    async def test_delete_event_ignored(self, webhook_client: AsyncClient):
        """Should ignore DELETE events."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "DELETE",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            data = response.json()
            assert data["success"] is True
            assert data["status"] == "ignored"


class TestPrefectFlowTriggering:
    """Tests for Prefect flow triggering."""

    async def test_insert_event_triggers_flow(self, webhook_client: AsyncClient):
        """Should trigger Prefect flow for INSERT event."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "tenant_tier": "premium",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            data = response.json()
            assert data["success"] is True
            assert data["status"] == "accepted"
            assert data["flow_run_id"] == "flow-run-123"
            assert "priority" in data["message"]

            # Verify flow was triggered with correct parameters
            mock_trigger.assert_called_once()
            call_args = mock_trigger.call_args[1]
            assert call_args["flow_name"] == "captionacc-video-initial-processing"
            assert call_args["parameters"]["video_id"] == "video-123"
            assert call_args["parameters"]["tenant_id"] == "tenant-456"
            assert call_args["parameters"]["storage_key"] == "tenant-456/videos/video-123.mp4"

    async def test_flow_triggered_with_priority(self, webhook_client: AsyncClient):
        """Should calculate and include priority when triggering flow."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "tenant_tier": "enterprise",
                        # Don't include timestamp to avoid timezone mismatch
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            # Verify priority was calculated (enterprise tier = 90 base priority)
            call_args = mock_trigger.call_args[1]
            assert call_args["priority"] >= 90

    async def test_flow_triggered_with_tags(self, webhook_client: AsyncClient):
        """Should include tags when triggering flow."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "tenant_tier": "free",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            # Verify tags were included
            call_args = mock_trigger.call_args[1]
            tags = call_args["tags"]
            assert "tenant:tenant-456" in tags
            assert "tier:free" in tags
            assert "trigger:webhook" in tags
            assert "event:video-insert" in tags
            assert any(tag.startswith("priority:") for tag in tags)
            assert any(tag.startswith("age-boosting:") for tag in tags)

    async def test_free_tier_priority(self, webhook_client: AsyncClient):
        """Should use correct priority for free tier."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "tenant_tier": "free",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            # Free tier base priority is 50
            call_args = mock_trigger.call_args[1]
            assert call_args["priority"] >= 50
            assert call_args["priority"] <= 70  # With age boosting

    async def test_premium_tier_priority(self, webhook_client: AsyncClient):
        """Should use correct priority for premium tier."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "tenant_tier": "premium",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            # Premium tier base priority is 70
            call_args = mock_trigger.call_args[1]
            assert call_args["priority"] >= 70

    async def test_default_tier_when_missing(self, webhook_client: AsyncClient):
        """Should default to free tier when tenant_tier is missing."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        # No tenant_tier
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            # Should default to free tier (priority ~50)
            call_args = mock_trigger.call_args[1]
            assert call_args["priority"] >= 50


class TestPrefectAPIErrors:
    """Tests for Prefect API error handling."""

    async def test_prefect_api_not_configured(self, webhook_client: AsyncClient):
        """Should return 503 when Prefect API is not configured."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = ""  # Not configured
            mock_settings.return_value = settings

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 503
            assert "Prefect API URL not configured" in response.json()["detail"]

    async def test_prefect_api_http_error(self, webhook_client: AsyncClient):
        """Should return 502 when Prefect API returns HTTP error."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            settings.prefect_api_key = "test-key"
            mock_settings.return_value = settings

            # Mock HTTP error response by patching AsyncClient context manager
            with patch("app.routers.webhooks.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value.__aenter__.return_value = mock_client

                error_response = MagicMock()
                error_response.status_code = 500
                error_response.text = "Internal Server Error"
                mock_client.post = AsyncMock(
                    side_effect=httpx.HTTPStatusError(
                        "Server error", request=MagicMock(), response=error_response
                    )
                )

                response = await webhook_client.post(
                    "/webhooks/supabase/videos",
                    json={
                        "type": "INSERT",
                        "table": "videos",
                        "record": {
                            "id": "video-123",
                            "tenant_id": "tenant-456",
                            "storage_key": "tenant-456/videos/video-123.mp4",
                        },
                    },
                    headers={"Authorization": "Bearer test-secret"},
                )
                assert response.status_code == 502
                assert "Failed to trigger Prefect flow" in response.json()["detail"]

    async def test_prefect_api_connection_error(self, webhook_client: AsyncClient):
        """Should return 503 when cannot connect to Prefect API."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings

            # Mock connection error by patching AsyncClient context manager
            with patch("app.routers.webhooks.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value.__aenter__.return_value = mock_client
                mock_client.post = AsyncMock(
                    side_effect=httpx.ConnectError("Connection refused")
                )

                response = await webhook_client.post(
                    "/webhooks/supabase/videos",
                    json={
                        "type": "INSERT",
                        "table": "videos",
                        "record": {
                            "id": "video-123",
                            "tenant_id": "tenant-456",
                            "storage_key": "tenant-456/videos/video-123.mp4",
                        },
                    },
                    headers={"Authorization": "Bearer test-secret"},
                )
                assert response.status_code == 503
                assert "Failed to connect to Prefect API" in response.json()["detail"]

    async def test_prefect_api_timeout(self, webhook_client: AsyncClient):
        """Should return 503 when Prefect API times out."""
        with patch("app.routers.webhooks.get_settings") as mock_settings:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings

            # Mock timeout error by patching AsyncClient context manager
            with patch("app.routers.webhooks.httpx.AsyncClient") as mock_client_class:
                mock_client = MagicMock()
                mock_client_class.return_value.__aenter__.return_value = mock_client
                mock_client.post = AsyncMock(
                    side_effect=httpx.TimeoutException("Request timed out")
                )

                response = await webhook_client.post(
                    "/webhooks/supabase/videos",
                    json={
                        "type": "INSERT",
                        "table": "videos",
                        "record": {
                            "id": "video-123",
                            "tenant_id": "tenant-456",
                            "storage_key": "tenant-456/videos/video-123.mp4",
                        },
                    },
                    headers={"Authorization": "Bearer test-secret"},
                )
                assert response.status_code == 503
                assert "Failed to connect to Prefect API" in response.json()["detail"]


class TestAgeBoosting:
    """Tests for age-based priority boosting."""

    async def test_old_request_gets_boosted_priority(self, webhook_client: AsyncClient):
        """Should boost priority for older requests."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger, patch(
            "app.routers.webhooks.calculate_flow_priority"
        ) as mock_priority:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }
            # Mock priority calculation to return boosted value
            mock_priority.return_value = 53

            # Request from 3 hours ago (should get age boost)
            old_time = datetime.now(timezone.utc) - timedelta(hours=3)
            # Format as ISO string with Z suffix (matching Supabase format)
            old_timestamp = old_time.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "tenant_tier": "free",
                        "created_at": old_timestamp,
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            assert response.status_code == 200

            # Verify priority calculation was called with age_boosting enabled
            mock_priority.assert_called_once()
            call_kwargs = mock_priority.call_args[1]
            assert call_kwargs["tenant_tier"] == "free"
            assert call_kwargs["enable_age_boosting"] is True

            # Verify the boosted priority was used
            trigger_args = mock_trigger.call_args[1]
            assert trigger_args["priority"] == 53

    async def test_invalid_timestamp_handled_gracefully(
        self, webhook_client: AsyncClient
    ):
        """Should handle invalid created_at timestamp gracefully."""
        with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
            "app.routers.webhooks.trigger_prefect_flow", new_callable=AsyncMock
        ) as mock_trigger:
            settings = MagicMock()
            settings.webhook_secret = "test-secret"
            settings.prefect_api_url = "https://api.prefect.cloud"
            mock_settings.return_value = settings
            mock_trigger.return_value = {
                "flow_run_id": "flow-run-123",
                "status": "SCHEDULED",
            }

            response = await webhook_client.post(
                "/webhooks/supabase/videos",
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "created_at": "invalid-timestamp",
                    },
                },
                headers={"Authorization": "Bearer test-secret"},
            )
            # Should still succeed with default priority
            assert response.status_code == 200
