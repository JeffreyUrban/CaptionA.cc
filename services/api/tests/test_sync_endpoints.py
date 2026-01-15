"""Tests for sync REST endpoints."""

from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


class MockDatabaseStateRepository:
    """Mock repository for database state operations."""

    def __init__(self):
        self.states: dict[str, dict] = {}
        self._lock_holder: str | None = None
        self._locked_at: datetime | None = None

    async def get_state(self, video_id: str, db_name: str):
        key = f"{video_id}/{db_name}"
        return self.states.get(key)

    async def get_or_create_state(self, video_id: str, db_name: str, tenant_id: str):
        key = f"{video_id}/{db_name}"
        if key not in self.states:
            self.states[key] = {
                "video_id": video_id,
                "database_name": db_name,
                "tenant_id": tenant_id,
                "server_version": 0,
                "wasabi_version": 0,
                "lock_holder_user_id": None,
                "lock_type": None,
                "locked_at": None,
                "active_connection_id": None,
            }
        return self.states[key]

    async def acquire_lock(
        self,
        video_id: str,
        db_name: str,
        user_id: str,
        connection_id: str,
        tenant_id: str,
    ):
        key = f"{video_id}/{db_name}"
        now = datetime.now(timezone.utc)
        if key not in self.states:
            await self.get_or_create_state(video_id, db_name, tenant_id)
        self.states[key].update(
            {
                "lock_holder_user_id": user_id,
                "lock_type": "client",
                "locked_at": now.isoformat(),
                "active_connection_id": connection_id,
            }
        )
        return self.states[key]

    async def release_lock(self, video_id: str, db_name: str):
        key = f"{video_id}/{db_name}"
        if key in self.states:
            self.states[key].update(
                {
                    "lock_holder_user_id": None,
                    "lock_type": None,
                    "locked_at": None,
                    "active_connection_id": None,
                }
            )
        return self.states.get(key, {})


class MockWebSocketManager:
    """Mock WebSocket manager."""

    def __init__(self):
        self._connection_counter = 0
        self._notified_connections: list[str] = []

    def generate_connection_id(self) -> str:
        self._connection_counter += 1
        return f"mock-connection-{self._connection_counter}"

    async def notify_session_transferred(self, connection_id: str):
        self._notified_connections.append(connection_id)


class MockCRSqliteManager:
    """Mock CR-SQLite manager."""

    def __init__(self, has_working_copy: bool = False):
        self._has_working_copy = has_working_copy

    def has_working_copy(self, _tenant_id: str, _video_id: str, _db_name: str) -> bool:
        return self._has_working_copy


@pytest.fixture
def mock_state_repo():
    """Create mock database state repository."""
    return MockDatabaseStateRepository()


@pytest.fixture
def mock_ws_manager():
    """Create mock WebSocket manager."""
    return MockWebSocketManager()


@pytest.fixture
def mock_cr_manager():
    """Create mock CR-SQLite manager."""
    return MockCRSqliteManager(has_working_copy=False)


@pytest.fixture
def mock_cr_manager_with_working_copy():
    """Create mock CR-SQLite manager with existing working copy."""
    return MockCRSqliteManager(has_working_copy=True)


@pytest.fixture
async def sync_client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_state_repo: MockDatabaseStateRepository,
    mock_ws_manager: MockWebSocketManager,
    mock_cr_manager: MockCRSqliteManager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create test client for sync endpoints."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with (
        patch(
            "app.routers.sync.DatabaseStateRepository",
            return_value=mock_state_repo,
        ),
        patch(
            "app.routers.sync.get_websocket_manager",
            return_value=mock_ws_manager,
        ),
        patch(
            "app.routers.sync.get_crsqlite_manager",
            return_value=mock_cr_manager,
        ),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def sync_client_with_working_copy(
    app: FastAPI,
    auth_context: AuthContext,
    mock_state_repo: MockDatabaseStateRepository,
    mock_ws_manager: MockWebSocketManager,
    mock_cr_manager_with_working_copy: MockCRSqliteManager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create test client for sync endpoints with existing working copy."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with (
        patch(
            "app.routers.sync.DatabaseStateRepository",
            return_value=mock_state_repo,
        ),
        patch(
            "app.routers.sync.get_websocket_manager",
            return_value=mock_ws_manager,
        ),
        patch(
            "app.routers.sync.get_crsqlite_manager",
            return_value=mock_cr_manager_with_working_copy,
        ),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


class TestGetDatabaseState:
    """Tests for GET /videos/{video_id}/database/{db}/state endpoint."""

    async def test_get_state_no_existing_state(
        self, sync_client: AsyncClient, test_video_id: str
    ):
        """Should return defaults when no state exists."""
        response = await sync_client.get(
            f"/videos/{test_video_id}/database/layout/state"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["server_version"] == 0
        assert data["wasabi_version"] == 0
        assert data["wasabi_synced"] is True
        assert data["lock_holder_user_id"] is None
        assert data["lock_holder_is_you"] is False
        assert data["lock_type"] is None

    async def test_get_state_with_existing_state(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        test_user_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should return existing state."""
        # Pre-populate state
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "server_version": 5,
            "wasabi_version": 3,
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }

        response = await sync_client.get(
            f"/videos/{test_video_id}/database/layout/state"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["server_version"] == 5
        assert data["wasabi_version"] == 3
        assert data["wasabi_synced"] is False
        assert data["lock_holder_user_id"] == test_user_id
        assert data["lock_holder_is_you"] is True
        assert data["lock_type"] == "client"

    async def test_get_state_locked_by_other_user(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should indicate lock holder is not current user."""
        other_user_id = "other-user-999"
        mock_state_repo.states[f"{test_video_id}/captions"] = {
            "video_id": test_video_id,
            "database_name": "captions",
            "server_version": 1,
            "wasabi_version": 1,
            "lock_holder_user_id": other_user_id,
            "lock_type": "client",
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }

        response = await sync_client.get(
            f"/videos/{test_video_id}/database/captions/state"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["lock_holder_user_id"] == other_user_id
        assert data["lock_holder_is_you"] is False

    async def test_get_state_invalid_database_name(
        self, sync_client: AsyncClient, test_video_id: str
    ):
        """Should reject invalid database names."""
        response = await sync_client.get(
            f"/videos/{test_video_id}/database/invalid_db/state"
        )
        assert response.status_code == 422  # Validation error


class TestAcquireLock:
    """Tests for POST /videos/{video_id}/database/{db}/lock endpoint."""

    async def test_acquire_lock_success(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
    ):
        """Should grant lock when not held."""
        response = await sync_client.post(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["granted"] is True
        assert "websocket_url" in data
        assert data["needs_download"] is True  # No working copy
        assert data["server_version"] == 0
        assert data["wasabi_version"] == 0

    async def test_acquire_lock_with_working_copy(
        self,
        sync_client_with_working_copy: AsyncClient,
        test_video_id: str,
    ):
        """Should not need download when working copy exists."""
        response = await sync_client_with_working_copy.post(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["granted"] is True
        assert data["needs_download"] is False

    async def test_acquire_lock_denied_other_user(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should deny lock when held by another user."""
        other_user_id = "other-user-999"
        locked_at = datetime.now(timezone.utc)
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "server_version": 1,
            "wasabi_version": 1,
            "lock_holder_user_id": other_user_id,
            "lock_type": "client",
            "locked_at": locked_at.isoformat(),
            "active_connection_id": "other-conn-123",
        }

        response = await sync_client.post(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["granted"] is False
        assert data["lock_holder_user_id"] == other_user_id

    async def test_acquire_lock_session_transfer(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        test_user_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
    ):
        """Should transfer session when same user re-acquires lock."""
        old_connection_id = "old-conn-456"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "server_version": 5,
            "wasabi_version": 3,
            "lock_holder_user_id": test_user_id,  # Same user
            "lock_type": "client",
            "locked_at": datetime.now(timezone.utc).isoformat(),
            "active_connection_id": old_connection_id,
        }

        response = await sync_client.post(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["granted"] is True
        assert data["server_version"] == 5
        assert data["wasabi_version"] == 3
        # Old connection should have been notified
        assert old_connection_id in mock_ws_manager._notified_connections


class TestReleaseLock:
    """Tests for DELETE /videos/{video_id}/database/{db}/lock endpoint."""

    async def test_release_lock_success(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        test_user_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should release lock when held by current user."""
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "server_version": 1,
            "wasabi_version": 1,
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }

        response = await sync_client.delete(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["released"] is True

    async def test_release_lock_not_held_by_user(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should not release lock held by another user."""
        other_user_id = "other-user-999"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "server_version": 1,
            "wasabi_version": 1,
            "lock_holder_user_id": other_user_id,
            "lock_type": "client",
            "locked_at": datetime.now(timezone.utc).isoformat(),
        }

        response = await sync_client.delete(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["released"] is False

    async def test_release_lock_not_held(
        self, sync_client: AsyncClient, test_video_id: str
    ):
        """Should return false when no lock exists."""
        response = await sync_client.delete(
            f"/videos/{test_video_id}/database/layout/lock"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["released"] is False


class TestEnsureDatabaseState:
    """Tests for POST /videos/{video_id}/database/{db}/ensure-state endpoint."""

    async def test_ensure_state_creates_new(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should create state if not exists."""
        response = await sync_client.post(
            f"/videos/{test_video_id}/database/layout/ensure-state"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["video_id"] == test_video_id
        assert data["database_name"] == "layout"
        assert data["server_version"] == 0
        assert data["wasabi_version"] == 0

        # State should now exist in mock
        assert f"{test_video_id}/layout" in mock_state_repo.states

    async def test_ensure_state_returns_existing(
        self,
        sync_client: AsyncClient,
        test_video_id: str,
        mock_state_repo: MockDatabaseStateRepository,
    ):
        """Should return existing state."""
        mock_state_repo.states[f"{test_video_id}/captions"] = {
            "video_id": test_video_id,
            "database_name": "captions",
            "server_version": 5,
            "wasabi_version": 3,
        }

        response = await sync_client.post(
            f"/videos/{test_video_id}/database/captions/ensure-state"
        )
        assert response.status_code == 200

        data = response.json()
        assert data["server_version"] == 5
        assert data["wasabi_version"] == 3
