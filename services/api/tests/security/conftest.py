"""Pytest fixtures for security tests."""

from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


# =============================================================================
# Authentication and Authorization Fixtures
# =============================================================================


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
