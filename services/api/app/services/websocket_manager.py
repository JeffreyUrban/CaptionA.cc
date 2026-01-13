"""WebSocket connection manager for sync sessions.

Manages active WebSocket connections, session transfers, and message routing.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class SyncSession:
    """Active sync session for a database."""

    connection_id: str
    websocket: WebSocket
    tenant_id: str
    video_id: str
    db_name: str
    user_id: str
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class WebSocketManager:
    """Manages active WebSocket connections for CR-SQLite sync.

    Features:
    - Connection registration/deregistration
    - Session transfer (same user, new tab)
    - Message routing
    - Activity tracking
    """

    def __init__(self):
        self._sessions: dict[str, SyncSession] = {}
        self._by_database: dict[str, str] = {}  # database_key -> connection_id

    def generate_connection_id(self) -> str:
        """Generate unique connection ID."""
        return str(uuid.uuid4())

    def _database_key(self, tenant_id: str, video_id: str, db_name: str) -> str:
        """Generate database lookup key."""
        return f"{tenant_id}/{video_id}/{db_name}"

    async def connect(
        self,
        websocket: WebSocket,
        connection_id: str,
        tenant_id: str,
        video_id: str,
        db_name: str,
        user_id: str,
    ) -> SyncSession:
        """Register new WebSocket connection.

        Args:
            websocket: FastAPI WebSocket instance
            connection_id: Pre-generated connection ID (from lock acquisition)
            tenant_id: Tenant UUID
            video_id: Video UUID
            db_name: Database name
            user_id: User UUID

        Returns:
            Created SyncSession
        """
        await websocket.accept()

        session = SyncSession(
            connection_id=connection_id,
            websocket=websocket,
            tenant_id=tenant_id,
            video_id=video_id,
            db_name=db_name,
            user_id=user_id,
        )

        db_key = self._database_key(tenant_id, video_id, db_name)

        # Handle session transfer (same user, new connection)
        if db_key in self._by_database:
            old_connection_id = self._by_database[db_key]
            old_session = self._sessions.get(old_connection_id)
            if old_session and old_session.user_id == user_id:
                # Notify old session of transfer
                await self.notify_session_transferred(old_connection_id)
                # Clean up old session
                await self.disconnect(old_connection_id)

        self._sessions[connection_id] = session
        self._by_database[db_key] = connection_id

        logger.info(f"WebSocket connected: {connection_id} for {db_key}")
        return session

    async def disconnect(self, connection_id: str) -> None:
        """Remove connection from manager.

        Args:
            connection_id: Connection to remove
        """
        session = self._sessions.pop(connection_id, None)
        if session:
            db_key = self._database_key(
                session.tenant_id, session.video_id, session.db_name
            )
            # Only remove from by_database if this connection is the current one
            if self._by_database.get(db_key) == connection_id:
                del self._by_database[db_key]
            logger.info(f"WebSocket disconnected: {connection_id}")

    def get_session(self, connection_id: str) -> SyncSession | None:
        """Get session by connection ID."""
        return self._sessions.get(connection_id)

    def get_active_connection(
        self, tenant_id: str, video_id: str, db_name: str
    ) -> str | None:
        """Get active connection ID for a database."""
        db_key = self._database_key(tenant_id, video_id, db_name)
        return self._by_database.get(db_key)

    async def send_message(self, connection_id: str, message: dict) -> bool:
        """Send JSON message to connection.

        Args:
            connection_id: Target connection
            message: Message dict to send as JSON

        Returns:
            True if sent successfully, False otherwise
        """
        session = self._sessions.get(connection_id)
        if session:
            try:
                await session.websocket.send_json(message)
                session.last_activity_at = datetime.now(timezone.utc)
                return True
            except Exception as e:
                logger.warning(f"Failed to send message to {connection_id}: {e}")
                return False
        return False

    async def notify_session_transferred(self, connection_id: str) -> None:
        """Notify connection that session was transferred to another tab/window.

        Args:
            connection_id: Connection to notify
        """
        await self.send_message(
            connection_id,
            {
                "type": "session_transferred",
                "message": "Editing moved to another window",
            },
        )
        logger.info(f"Session transfer notification sent to {connection_id}")

    async def notify_lock_changed(
        self, connection_id: str, lock_type: str, message: str
    ) -> None:
        """Notify connection of lock type change.

        Args:
            connection_id: Connection to notify
            lock_type: New lock type ('client' or 'server')
            message: Human-readable message
        """
        await self.send_message(
            connection_id,
            {
                "type": "lock_changed",
                "lock_type": lock_type,
                "message": message,
            },
        )

    async def send_server_update(
        self,
        connection_id: str,
        db_name: str,
        changes: list[dict],
        server_version: int,
    ) -> None:
        """Push server changes to client (for bidirectional sync).

        Args:
            connection_id: Connection to send to
            db_name: Database name
            changes: List of CR-SQLite change records
            server_version: Current server version
        """
        await self.send_message(
            connection_id,
            {
                "type": "server_update",
                "db": db_name,
                "changes": changes,
                "server_version": server_version,
            },
        )

    async def send_error(
        self, connection_id: str, code: str, message: str
    ) -> None:
        """Send error message to connection.

        Args:
            connection_id: Connection to send to
            code: Error code (INVALID_FORMAT, WORKFLOW_LOCKED, etc.)
            message: Human-readable error message
        """
        await self.send_message(
            connection_id,
            {
                "type": "error",
                "code": code,
                "message": message,
            },
        )

    async def send_ack(
        self, connection_id: str, server_version: int, applied_count: int
    ) -> None:
        """Send acknowledgment of applied changes.

        Args:
            connection_id: Connection to send to
            server_version: Current server version after changes
            applied_count: Number of changes applied
        """
        await self.send_message(
            connection_id,
            {
                "type": "ack",
                "server_version": server_version,
                "applied_count": applied_count,
            },
        )

    def update_activity(self, connection_id: str) -> None:
        """Update last activity timestamp for a connection."""
        session = self._sessions.get(connection_id)
        if session:
            session.last_activity_at = datetime.now(timezone.utc)

    def get_all_sessions(self) -> list[SyncSession]:
        """Get all active sessions."""
        return list(self._sessions.values())


# Singleton instance
_websocket_manager: WebSocketManager | None = None


def get_websocket_manager() -> WebSocketManager:
    """Get singleton WebSocketManager."""
    global _websocket_manager
    if _websocket_manager is None:
        _websocket_manager = WebSocketManager()
    return _websocket_manager
