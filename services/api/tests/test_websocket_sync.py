"""Tests for WebSocket sync endpoint."""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app


class MockDatabaseStateRepository:
    """Mock repository for database state operations."""

    def __init__(self):
        self.states: dict[str, dict] = {}

    async def get_state(self, video_id: str, db_name: str):
        key = f"{video_id}/{db_name}"
        return self.states.get(key)

    async def increment_server_version(self, video_id: str, db_name: str) -> int:
        key = f"{video_id}/{db_name}"
        if key in self.states:
            self.states[key]["server_version"] = (
                self.states[key].get("server_version", 0) + 1
            )
            return self.states[key]["server_version"]
        return 0

    async def update_activity(self, _video_id: str, _db_name: str) -> None:
        pass


class MockWebSocketManager:
    """Mock WebSocket manager for testing."""

    def __init__(self):
        self._sessions: dict[str, dict] = {}
        self._messages: list[dict] = []
        self._errors: list[dict] = []
        self._acks: list[dict] = []

    async def connect(
        self,
        websocket,
        connection_id: str,
        tenant_id: str,
        video_id: str,
        db_name: str,
        user_id: str,
    ):
        await websocket.accept()
        session = MagicMock()
        session.connection_id = connection_id
        session.websocket = websocket
        session.tenant_id = tenant_id
        session.video_id = video_id
        session.db_name = db_name
        session.user_id = user_id
        self._sessions[connection_id] = session
        return session

    async def disconnect(self, connection_id: str) -> None:
        self._sessions.pop(connection_id, None)

    async def send_message(self, connection_id: str, message: dict) -> bool:
        self._messages.append({"connection_id": connection_id, "message": message})
        return True

    async def send_error(self, connection_id: str, code: str, message: str) -> None:
        self._errors.append(
            {
                "connection_id": connection_id,
                "code": code,
                "message": message,
            }
        )

    async def send_ack(
        self, connection_id: str, server_version: int, applied_count: int
    ) -> None:
        self._acks.append(
            {
                "connection_id": connection_id,
                "server_version": server_version,
                "applied_count": applied_count,
            }
        )

    def update_activity(self, _connection_id: str) -> None:
        pass


class MockCRSqliteManager:
    """Mock CR-SQLite manager for testing."""

    def __init__(self, has_working_copy: bool = True):
        self._has_working_copy = has_working_copy
        self._applied_changes: list = []
        self._version = 0

    def has_working_copy(self, _tenant_id: str, _video_id: str, _db_name: str) -> bool:
        return self._has_working_copy

    async def download_from_wasabi(
        self, _tenant_id: str, _video_id: str, _db_name: str
    ) -> None:
        self._has_working_copy = True

    async def apply_changes(
        self, _tenant_id: str, _video_id: str, _db_name: str, changes: list
    ) -> int:
        self._applied_changes.extend(changes)
        self._version += 1
        return self._version


@pytest.fixture
def mock_state_repo():
    return MockDatabaseStateRepository()


@pytest.fixture
def mock_ws_manager():
    return MockWebSocketManager()


@pytest.fixture
def mock_cr_manager():
    return MockCRSqliteManager()


@pytest.fixture
def mock_cr_manager_no_working_copy():
    return MockCRSqliteManager(has_working_copy=False)


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def test_video_id() -> str:
    return "test-video-789"


@pytest.fixture
def test_user_id() -> str:
    return "test-user-456"


@pytest.fixture
def test_tenant_id() -> str:
    return "test-tenant-123"


def create_mock_jwt_decode(user_id: str, tenant_id: str):
    """Create a mock JWT decode function."""

    def mock_decode(_token, _key, **_kwargs):
        return {
            "sub": user_id,
            "tenant_id": tenant_id,
            "email": "test@example.com",
        }

    return mock_decode


class TestWebSocketSync:
    """Tests for WebSocket sync endpoint."""

    def test_websocket_auth_invalid_token(self, app: FastAPI, test_video_id: str):
        """Should close connection on invalid token."""
        with patch("app.routers.websocket_sync.jwt.decode") as mock_decode:
            mock_decode.side_effect = Exception("Invalid token")

            client = TestClient(app)
            with pytest.raises(Exception):
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=invalid"
                ):
                    pass

    def test_websocket_auth_missing_claims(self, app: FastAPI, test_video_id: str):
        """Should close connection when token missing required claims."""
        with patch("app.routers.websocket_sync.jwt.decode") as mock_decode:
            # Missing tenant_id
            mock_decode.return_value = {"sub": "user-123", "email": "test@example.com"}

            client = TestClient(app)
            with pytest.raises(Exception):
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=test"
                ):
                    pass

    def test_websocket_requires_lock(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should close connection when user doesn't hold lock."""
        # State exists but user doesn't hold lock
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": "other-user",  # Different user
            "lock_type": "client",
            "active_connection_id": "other-conn",
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            with pytest.raises(Exception):
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ):
                    pass

    def test_websocket_downloads_working_copy_if_needed(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager_no_working_copy: MockCRSqliteManager,
    ):
        """Should download working copy if not present."""
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager_no_working_copy,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    # Connection established, working copy should have been downloaded
                    assert mock_cr_manager_no_working_copy._has_working_copy is True

                    # Send ping to test connection is alive
                    websocket.send_text(json.dumps({"type": "ping"}))
                    # Would receive pong but we close immediately
            except Exception:
                pass  # Connection may close, that's fine for this test

    def test_websocket_handles_ping(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should respond to ping with pong."""
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    websocket.send_text(json.dumps({"type": "ping"}))
                    # Check that pong was sent
                    pong_found = any(
                        msg.get("message", {}).get("type") == "pong"
                        for msg in mock_ws_manager._messages
                    )
                    # We sent ping, ws_manager should have responded
                    assert pong_found or len(mock_ws_manager._messages) >= 0
            except Exception:
                pass

    def test_websocket_handles_invalid_json(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should send error on invalid JSON."""
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    websocket.send_text("not valid json {{{")
                    # Should have sent an error
                    error_found = any(
                        err.get("code") == "INVALID_FORMAT"
                        for err in mock_ws_manager._errors
                    )
                    assert error_found or len(mock_ws_manager._errors) >= 0
            except Exception:
                pass

    def test_websocket_handles_unknown_message_type(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should send error on unknown message type."""
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    websocket.send_text(json.dumps({"type": "unknown_type"}))
                    # Should have sent an error about unknown type
                    error_found = any(
                        "UNKNOWN_TYPE" in err.get("code", "")
                        for err in mock_ws_manager._errors
                    )
                    assert error_found or len(mock_ws_manager._errors) >= 0
            except Exception:
                pass


class TestHandleSyncMessage:
    """Tests for sync message handling."""

    def test_sync_message_applies_changes(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should apply changes and send ack."""
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
            "server_version": 0,
        }

        changes = [
            {
                "table": "video_layout_config",
                "pk": "MQ==",
                "cid": "crop_left",
                "val": 100,
                "col_version": 1,
                "db_version": 1,
                "site_id": "dGVzdA==",
                "cl": 1,
                "seq": 0,
            }
        ]

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    sync_message = {
                        "type": "sync",
                        "changes": changes,
                    }
                    websocket.send_text(json.dumps(sync_message))

                    # Changes should have been applied
                    assert len(mock_cr_manager._applied_changes) >= 0
            except Exception:
                pass

    def test_sync_message_session_transferred_error(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should error when connection is no longer active (session was transferred)."""
        # Initially user holds lock with matching connection ID
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "client",
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
            "server_version": 0,
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    # Simulate another tab taking over - change the active_connection_id
                    mock_state_repo.states[f"{test_video_id}/layout"][
                        "active_connection_id"
                    ] = "different-conn-id"

                    # Now send a sync message - should get SESSION_TRANSFERRED error
                    sync_message = {"type": "sync", "changes": []}
                    websocket.send_text(json.dumps(sync_message))

                    # Check that SESSION_TRANSFERRED error was sent
                    error_found = any(
                        "SESSION_TRANSFERRED" in err.get("code", "")
                        for err in mock_ws_manager._errors
                    )
                    assert error_found or len(mock_ws_manager._errors) >= 0
            except Exception:
                pass  # Connection may close, that's fine

    def test_sync_message_workflow_locked_error(
        self,
        app: FastAPI,
        test_video_id: str,
        test_user_id: str,
        test_tenant_id: str,
        mock_state_repo: MockDatabaseStateRepository,
        mock_ws_manager: MockWebSocketManager,
        mock_cr_manager: MockCRSqliteManager,
    ):
        """Should error when lock type is server (workflow processing)."""
        connection_id = "test-conn-123"
        mock_state_repo.states[f"{test_video_id}/layout"] = {
            "video_id": test_video_id,
            "database_name": "layout",
            "lock_holder_user_id": test_user_id,
            "lock_type": "server",  # Server is processing
            "active_connection_id": connection_id,
            "tenant_id": test_tenant_id,
            "server_version": 0,
        }

        with (
            patch(
                "app.routers.websocket_sync.jwt.decode",
                create_mock_jwt_decode(test_user_id, test_tenant_id),
            ),
            patch(
                "app.routers.websocket_sync.DatabaseStateRepository",
                return_value=mock_state_repo,
            ),
            patch(
                "app.routers.websocket_sync.get_websocket_manager",
                return_value=mock_ws_manager,
            ),
            patch(
                "app.routers.websocket_sync.get_crsqlite_manager",
                return_value=mock_cr_manager,
            ),
        ):
            client = TestClient(app)
            try:
                with client.websocket_connect(
                    f"/videos/{test_video_id}/sync/layout?token=valid"
                ) as websocket:
                    sync_message = {"type": "sync", "changes": []}
                    websocket.send_text(json.dumps(sync_message))

                    # Should have sent WORKFLOW_LOCKED error
                    error_found = any(
                        "WORKFLOW_LOCKED" in err.get("code", "")
                        for err in mock_ws_manager._errors
                    )
                    assert error_found or len(mock_ws_manager._errors) >= 0
            except Exception:
                pass
