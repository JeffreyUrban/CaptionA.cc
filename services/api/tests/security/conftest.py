"""Pytest fixtures for security tests."""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


# =============================================================================
# Authentication and Authorization Fixtures
# =============================================================================


@pytest.fixture
def webhook_secret() -> str:
    """Valid webhook secret for testing."""
    return "test-webhook-secret-123"


@pytest.fixture
def invalid_webhook_secret() -> str:
    """Invalid webhook secret for testing unauthorized access."""
    return "wrong-webhook-secret"


@pytest.fixture
def webhook_auth_header(webhook_secret: str) -> dict[str, str]:
    """Valid Authorization header for webhook requests."""
    return {"Authorization": f"Bearer {webhook_secret}"}


@pytest.fixture
def invalid_webhook_auth_header(invalid_webhook_secret: str) -> dict[str, str]:
    """Invalid Authorization header for webhook requests."""
    return {"Authorization": f"Bearer {invalid_webhook_secret}"}


@pytest.fixture
def malformed_webhook_auth_header() -> dict[str, str]:
    """Malformed Authorization header (missing Bearer prefix)."""
    return {"Authorization": "test-webhook-secret-123"}


@pytest.fixture
def tenant_a_id() -> str:
    """First test tenant ID for isolation tests."""
    return "tenant-a-uuid"


@pytest.fixture
def tenant_b_id() -> str:
    """Second test tenant ID for isolation tests."""
    return "tenant-b-uuid"


@pytest.fixture
def tenant_a_user_id() -> str:
    """User ID for tenant A."""
    return "user-a-uuid"


@pytest.fixture
def tenant_b_user_id() -> str:
    """User ID for tenant B."""
    return "user-b-uuid"


@pytest.fixture
def tenant_a_video_id() -> str:
    """Video ID belonging to tenant A."""
    return "video-a-uuid"


@pytest.fixture
def tenant_b_video_id() -> str:
    """Video ID belonging to tenant B."""
    return "video-b-uuid"


@pytest.fixture
def tenant_a_auth_context(tenant_a_id: str, tenant_a_user_id: str) -> AuthContext:
    """Auth context for tenant A."""
    return AuthContext(
        user_id=tenant_a_user_id,
        tenant_id=tenant_a_id,
        email="user-a@tenant-a.com",
    )


@pytest.fixture
def tenant_b_auth_context(tenant_b_id: str, tenant_b_user_id: str) -> AuthContext:
    """Auth context for tenant B."""
    return AuthContext(
        user_id=tenant_b_user_id,
        tenant_id=tenant_b_id,
        email="user-b@tenant-b.com",
    )


# =============================================================================
# Webhook Payload Fixtures
# =============================================================================


@pytest.fixture
def test_webhook_payload(tenant_a_id: str, tenant_a_video_id: str) -> dict:
    """Valid webhook payload for video INSERT event."""
    from datetime import datetime, timezone

    # Use current time to avoid age boost issues in tests
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "type": "INSERT",
        "table": "videos",
        "record": {
            "id": tenant_a_video_id,
            "tenant_id": tenant_a_id,
            "storage_key": f"{tenant_a_id}/client/videos/{tenant_a_video_id}/video.mp4",
            "status": "uploading",
            "created_at": now,
            "tenant_tier": "free",
        },
    }


@pytest.fixture
def test_webhook_payload_premium(tenant_a_id: str, tenant_a_video_id: str) -> dict:
    """Valid webhook payload for premium tier tenant."""
    from datetime import datetime, timezone

    # Use current time to avoid age boost issues in tests
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "type": "INSERT",
        "table": "videos",
        "record": {
            "id": tenant_a_video_id,
            "tenant_id": tenant_a_id,
            "storage_key": f"{tenant_a_id}/client/videos/{tenant_a_video_id}/video.mp4",
            "status": "uploading",
            "created_at": now,
            "tenant_tier": "premium",
        },
    }


@pytest.fixture
def test_webhook_payload_missing_fields(tenant_a_id: str) -> dict:
    """Webhook payload missing required fields."""
    return {
        "type": "INSERT",
        "table": "videos",
        "record": {
            "tenant_id": tenant_a_id,
            # Missing: id, storage_key
            "status": "uploading",
        },
    }


@pytest.fixture
def test_webhook_payload_update(tenant_a_id: str, tenant_a_video_id: str) -> dict:
    """Webhook payload for UPDATE event (should be ignored)."""
    return {
        "type": "UPDATE",
        "table": "videos",
        "record": {
            "id": tenant_a_video_id,
            "tenant_id": tenant_a_id,
            "storage_key": f"{tenant_a_id}/client/videos/{tenant_a_video_id}/video.mp4",
            "status": "processing",
        },
        "old_record": {
            "id": tenant_a_video_id,
            "tenant_id": tenant_a_id,
            "storage_key": f"{tenant_a_id}/client/videos/{tenant_a_video_id}/video.mp4",
            "status": "uploading",
        },
    }


@pytest.fixture
def test_webhook_payload_wrong_table() -> dict:
    """Webhook payload for wrong table."""
    return {
        "type": "INSERT",
        "table": "users",  # Wrong table
        "record": {
            "id": "user-123",
            "email": "test@example.com",
        },
    }


# =============================================================================
# Webhook Client Fixtures
# =============================================================================


@pytest.fixture
def mock_trigger_prefect_flow() -> AsyncMock:
    """
    Mock for trigger_prefect_flow function.

    Returns an AsyncMock that can be used to verify Prefect flow trigger calls.
    """
    return AsyncMock(
        return_value={
            "flow_run_id": "test-flow-run-123",
            "status": "SCHEDULED",
        }
    )


@pytest.fixture
async def webhook_client(
    app: FastAPI,
    webhook_secret: str,
    mock_trigger_prefect_flow: AsyncMock,
) -> AsyncGenerator[AsyncClient, None]:
    """
    Create an async test client for webhook endpoints.

    This client is configured with a mocked Prefect API to avoid real API calls.
    The webhook_secret is patched into the settings.

    Use the mock_trigger_prefect_flow fixture to verify flow trigger calls in tests.
    """
    with patch("app.routers.webhooks.get_settings") as mock_settings, patch(
        "app.routers.webhooks.trigger_prefect_flow",
        mock_trigger_prefect_flow,
    ):
        # Configure mock settings
        mock_settings_instance = mock_settings.return_value
        mock_settings_instance.webhook_secret = webhook_secret
        mock_settings_instance.prefect_api_url = "http://test-prefect-api"
        mock_settings_instance.prefect_api_key = "test-api-key"

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


# =============================================================================
# Tenant Isolation Client Fixtures
# =============================================================================


@pytest.fixture
async def tenant_a_client(
    app: FastAPI,
    tenant_a_auth_context: AuthContext,
    mock_seeded_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client authenticated as tenant A."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: tenant_a_auth_context

    with patch(
        "app.routers.captions.get_database_manager",
        return_value=mock_seeded_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def tenant_b_client(
    app: FastAPI,
    tenant_b_auth_context: AuthContext,
    mock_seeded_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client authenticated as tenant B."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: tenant_b_auth_context

    with patch(
        "app.routers.captions.get_database_manager",
        return_value=mock_seeded_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()
