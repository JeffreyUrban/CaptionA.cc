"""Tests for admin endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.fixture
def admin_context() -> AuthContext:
    """Create an admin auth context."""
    return AuthContext(
        user_id="admin-user",
        tenant_id="platform",
        email="admin@captiona.cc",
        is_platform_admin=True,
    )


@pytest.fixture
async def admin_client(
    app: FastAPI,
    admin_context: AuthContext,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for admin endpoints."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: admin_context

    # Mock boto3 client for S3 operations
    mock_s3 = MagicMock()
    mock_s3.get_paginator.return_value.paginate.return_value = [
        {"CommonPrefixes": []}  # Empty bucket for testing
    ]

    with patch("app.routers.admin.boto3.client", return_value=mock_s3):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


class TestListDatabases:
    """Tests for GET /admin/databases endpoint."""

    async def test_list_databases(self, admin_client: AsyncClient):
        """Should return database list."""
        response = await admin_client.get("/admin/databases")
        assert response.status_code == 200

        data = response.json()
        assert "databases" in data
        assert "total" in data
        assert "current" in data
        assert "outdated" in data
        assert "incomplete" in data

    async def test_list_databases_with_search(self, admin_client: AsyncClient):
        """Should filter by video ID search."""
        response = await admin_client.get(
            "/admin/databases", params={"search": "test-video"}
        )
        assert response.status_code == 200

    async def test_list_databases_with_status_filter(self, admin_client: AsyncClient):
        """Should filter by status."""
        response = await admin_client.get(
            "/admin/databases", params={"status": "current"}
        )
        assert response.status_code == 200


class TestRepairDatabases:
    """Tests for POST /admin/databases/repair endpoint."""

    async def test_repair_databases(self, admin_client: AsyncClient):
        """Should return repair response (placeholder)."""
        response = await admin_client.post(
            "/admin/databases/repair",
            json={"force": False},
        )
        assert response.status_code == 200

        data = response.json()
        assert "success" in data
        assert "repaired" in data
        assert "failed" in data
        assert "errors" in data

    async def test_repair_databases_with_target_version(
        self, admin_client: AsyncClient
    ):
        """Should accept target version."""
        response = await admin_client.post(
            "/admin/databases/repair",
            json={"targetVersion": 2, "force": True},
        )
        assert response.status_code == 200


class TestSecurityAudit:
    """Tests for GET /admin/security endpoint."""

    async def test_security_audit_recent(self, admin_client: AsyncClient):
        """Should return recent security events."""
        response = await admin_client.get("/admin/security", params={"view": "recent"})
        assert response.status_code == 200

        data = response.json()
        assert data["view"] == "recent"
        assert "events" in data
        assert "timeWindowHours" in data

    async def test_security_audit_metrics(self, admin_client: AsyncClient):
        """Should return security metrics."""
        response = await admin_client.get("/admin/security", params={"view": "metrics"})
        assert response.status_code == 200

        data = response.json()
        assert data["view"] == "metrics"
        assert "metrics" in data
        assert data["metrics"]["totalEvents"] == 0

    async def test_security_audit_critical(self, admin_client: AsyncClient):
        """Should return critical events."""
        response = await admin_client.get(
            "/admin/security", params={"view": "critical"}
        )
        assert response.status_code == 200
        assert response.json()["view"] == "critical"

    async def test_security_audit_attacks(self, admin_client: AsyncClient):
        """Should return attack events."""
        response = await admin_client.get("/admin/security", params={"view": "attacks"})
        assert response.status_code == 200
        assert response.json()["view"] == "attacks"

    async def test_security_audit_custom_hours(self, admin_client: AsyncClient):
        """Should accept custom time window."""
        response = await admin_client.get("/admin/security", params={"hours": 48})
        assert response.status_code == 200
        assert response.json()["timeWindowHours"] == 48

    async def test_security_audit_default_view(self, admin_client: AsyncClient):
        """Should default to recent view."""
        response = await admin_client.get("/admin/security")
        assert response.status_code == 200
        assert response.json()["view"] == "recent"
