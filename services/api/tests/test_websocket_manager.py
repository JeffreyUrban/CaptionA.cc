"""Tests for WebSocket manager."""

from unittest.mock import AsyncMock

import pytest

from app.services.websocket_manager import WebSocketManager


@pytest.fixture
def ws_manager():
    """Create WebSocket manager instance."""
    return WebSocketManager()


@pytest.fixture
def mock_websocket():
    """Create mock WebSocket."""
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


@pytest.fixture
def test_connection_id():
    return "conn-123"


@pytest.fixture
def test_tenant_id():
    return "tenant-456"


@pytest.fixture
def test_video_id():
    return "video-789"


@pytest.fixture
def test_user_id():
    return "user-abc"


class TestWebSocketManagerConnect:
    """Tests for WebSocketManager.connect()."""

    async def test_connect_creates_session(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should create and return session."""
        session = await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        assert session is not None
        assert session.connection_id == test_connection_id
        assert session.tenant_id == test_tenant_id
        assert session.video_id == test_video_id
        assert session.db_name == "layout"
        assert session.user_id == test_user_id
        mock_websocket.accept.assert_called_once()

    async def test_connect_stores_session(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should store session for retrieval."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        retrieved = ws_manager.get_session(test_connection_id)
        assert retrieved is not None
        assert retrieved.connection_id == test_connection_id

    async def test_connect_tracks_by_database(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should track active connection by database."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        active = ws_manager.get_active_connection(
            test_tenant_id, test_video_id, "layout"
        )
        assert active == test_connection_id

    async def test_connect_transfers_session_same_user(
        self,
        ws_manager: WebSocketManager,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should transfer session when same user connects again."""
        old_ws = AsyncMock()
        old_ws.accept = AsyncMock()
        old_ws.send_json = AsyncMock()

        new_ws = AsyncMock()
        new_ws.accept = AsyncMock()
        new_ws.send_json = AsyncMock()

        # First connection
        await ws_manager.connect(
            websocket=old_ws,
            connection_id="old-conn",
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        # Second connection (same user)
        await ws_manager.connect(
            websocket=new_ws,
            connection_id="new-conn",
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        # Old session should have been notified
        old_ws.send_json.assert_called()
        # New connection should be active
        active = ws_manager.get_active_connection(
            test_tenant_id, test_video_id, "layout"
        )
        assert active == "new-conn"


class TestWebSocketManagerDisconnect:
    """Tests for WebSocketManager.disconnect()."""

    async def test_disconnect_removes_session(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should remove session on disconnect."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        await ws_manager.disconnect(test_connection_id)

        assert ws_manager.get_session(test_connection_id) is None

    async def test_disconnect_clears_database_tracking(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should clear database tracking on disconnect."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        await ws_manager.disconnect(test_connection_id)

        active = ws_manager.get_active_connection(
            test_tenant_id, test_video_id, "layout"
        )
        assert active is None

    async def test_disconnect_nonexistent_is_safe(self, ws_manager: WebSocketManager):
        """Should handle disconnecting nonexistent connection."""
        # Should not raise
        await ws_manager.disconnect("nonexistent-conn")


class TestWebSocketManagerSendMessage:
    """Tests for WebSocketManager.send_message()."""

    async def test_send_message_success(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should send message to connected WebSocket."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        result = await ws_manager.send_message(
            test_connection_id, {"type": "test", "data": "hello"}
        )

        assert result is True
        mock_websocket.send_json.assert_called_with({"type": "test", "data": "hello"})

    async def test_send_message_nonexistent_returns_false(
        self, ws_manager: WebSocketManager
    ):
        """Should return False when connection doesn't exist."""
        result = await ws_manager.send_message("nonexistent", {"type": "test"})
        assert result is False

    async def test_send_message_error_returns_false(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should return False when send fails."""
        mock_websocket.send_json.side_effect = Exception("Send failed")

        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        result = await ws_manager.send_message(test_connection_id, {"type": "test"})
        assert result is False


class TestWebSocketManagerNotifications:
    """Tests for WebSocketManager notification methods."""

    async def test_notify_session_transferred(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should send session_transferred message."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        await ws_manager.notify_session_transferred(test_connection_id)

        mock_websocket.send_json.assert_called()
        call_args = mock_websocket.send_json.call_args[0][0]
        assert call_args["type"] == "session_transferred"

    async def test_notify_lock_changed(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should send lock_changed message."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        await ws_manager.notify_lock_changed(
            test_connection_id, "server", "Processing started"
        )

        mock_websocket.send_json.assert_called()
        call_args = mock_websocket.send_json.call_args[0][0]
        assert call_args["type"] == "lock_changed"
        assert call_args["lock_type"] == "server"

    async def test_send_server_update(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should send server_update message."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        changes = [{"table": "test", "pk": "1"}]
        await ws_manager.send_server_update(test_connection_id, "layout", changes, 5)

        mock_websocket.send_json.assert_called()
        call_args = mock_websocket.send_json.call_args[0][0]
        assert call_args["type"] == "server_update"
        assert call_args["changes"] == changes
        assert call_args["server_version"] == 5

    async def test_send_error(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should send error message."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        await ws_manager.send_error(
            test_connection_id, "TEST_ERROR", "Something went wrong"
        )

        mock_websocket.send_json.assert_called()
        call_args = mock_websocket.send_json.call_args[0][0]
        assert call_args["type"] == "error"
        assert call_args["code"] == "TEST_ERROR"
        assert call_args["message"] == "Something went wrong"

    async def test_send_ack(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should send ack message."""
        await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        await ws_manager.send_ack(
            test_connection_id, server_version=10, applied_count=3
        )

        mock_websocket.send_json.assert_called()
        call_args = mock_websocket.send_json.call_args[0][0]
        assert call_args["type"] == "ack"
        assert call_args["server_version"] == 10
        assert call_args["applied_count"] == 3


class TestWebSocketManagerActivityTracking:
    """Tests for activity tracking."""

    async def test_update_activity(
        self,
        ws_manager: WebSocketManager,
        mock_websocket,
        test_connection_id: str,
        test_tenant_id: str,
        test_video_id: str,
        test_user_id: str,
    ):
        """Should update last_activity_at timestamp."""
        session = await ws_manager.connect(
            websocket=mock_websocket,
            connection_id=test_connection_id,
            tenant_id=test_tenant_id,
            video_id=test_video_id,
            db_name="layout",
            user_id=test_user_id,
        )

        original_activity = session.last_activity_at
        ws_manager.update_activity(test_connection_id)

        updated_session = ws_manager.get_session(test_connection_id)
        assert updated_session is not None
        assert updated_session.last_activity_at >= original_activity


class TestWebSocketManagerGenerateConnectionId:
    """Tests for connection ID generation."""

    def test_generates_unique_ids(self, ws_manager: WebSocketManager):
        """Should generate unique connection IDs."""
        ids = [ws_manager.generate_connection_id() for _ in range(100)]
        assert len(set(ids)) == 100  # All unique

    def test_id_is_uuid_format(self, ws_manager: WebSocketManager):
        """Should generate valid UUID format."""
        conn_id = ws_manager.generate_connection_id()
        # UUID format: 8-4-4-4-12 hex characters
        parts = conn_id.split("-")
        assert len(parts) == 5
        assert len(parts[0]) == 8
        assert len(parts[1]) == 4
        assert len(parts[2]) == 4
        assert len(parts[3]) == 4
        assert len(parts[4]) == 12


class TestWebSocketManagerGetAllSessions:
    """Tests for getting all sessions."""

    async def test_get_all_sessions_empty(self, ws_manager: WebSocketManager):
        """Should return empty list when no sessions."""
        sessions = ws_manager.get_all_sessions()
        assert sessions == []

    async def test_get_all_sessions(
        self,
        ws_manager: WebSocketManager,
        test_tenant_id: str,
        test_user_id: str,
    ):
        """Should return all active sessions."""
        ws1 = AsyncMock()
        ws1.accept = AsyncMock()
        ws2 = AsyncMock()
        ws2.accept = AsyncMock()

        await ws_manager.connect(
            websocket=ws1,
            connection_id="conn-1",
            tenant_id=test_tenant_id,
            video_id="video-1",
            db_name="layout",
            user_id=test_user_id,
        )
        await ws_manager.connect(
            websocket=ws2,
            connection_id="conn-2",
            tenant_id=test_tenant_id,
            video_id="video-2",
            db_name="captions",
            user_id=test_user_id,
        )

        sessions = ws_manager.get_all_sessions()
        assert len(sessions) == 2
        connection_ids = {s.connection_id for s in sessions}
        assert connection_ids == {"conn-1", "conn-2"}
