"""Database sync REST endpoints.

Handles lock acquisition and state queries for CR-SQLite sync.
Database downloads use STS credentials (via Edge Function) for direct S3 access.
"""

from fastapi import APIRouter

from app.config import get_settings
from app.dependencies import Auth
from app.models.sync import (
    DatabaseName,
    DatabaseStateResponse,
    LockDeniedResponse,
    LockGrantedResponse,
    LockReleaseResponse,
    LockType,
)
from app.services.crsqlite_manager import get_crsqlite_manager
from app.services.supabase_client import DatabaseStateRepository
from app.services.websocket_manager import get_websocket_manager

router = APIRouter()


@router.get("/{video_id}/database/{db}/state", response_model=DatabaseStateResponse)
async def get_database_state(video_id: str, db: DatabaseName, auth: Auth):
    """Get current database state including version and lock info.

    Returns information about:
    - Server and Wasabi versions (for sync status)
    - Lock holder (if any)
    - Whether the current user holds the lock
    """
    repo = DatabaseStateRepository()
    state = await repo.get_state(video_id, db.value)

    if state is None:
        # No state exists - return defaults
        return DatabaseStateResponse(
            server_version=0,
            wasabi_version=0,
            wasabi_synced=True,
            lock_holder_user_id=None,
            lock_holder_is_you=False,
            lock_type=None,
            locked_at=None,
        )

    lock_type = state.get("lock_type")
    return DatabaseStateResponse(
        server_version=state.get("server_version", 0),
        wasabi_version=state.get("wasabi_version", 0),
        wasabi_synced=state.get("server_version", 0) == state.get("wasabi_version", 0),
        lock_holder_user_id=state.get("lock_holder_user_id"),
        lock_holder_is_you=state.get("lock_holder_user_id") == auth.user_id,
        lock_type=LockType(lock_type) if lock_type else None,
        locked_at=state.get("locked_at"),
    )


@router.post(
    "/{video_id}/database/{db}/lock",
    response_model=LockGrantedResponse | LockDeniedResponse,
)
async def acquire_lock(video_id: str, db: DatabaseName, auth: Auth):
    """Acquire editing lock for a database.

    If the lock is held by another user, returns denied response.
    If the same user holds the lock (different tab), performs session transfer.

    Returns:
        - granted=True with WebSocket URL if lock acquired
        - granted=False with lock holder info if denied
    """
    repo = DatabaseStateRepository()
    ws_manager = get_websocket_manager()
    cr_manager = get_crsqlite_manager()
    settings = get_settings()

    # Get or create state record (auto-creates if this is first access)
    state = await repo.get_or_create_state(video_id, db.value, auth.tenant_id)

    # Check if locked by another user
    if state and state.get("lock_holder_user_id"):
        if state["lock_holder_user_id"] != auth.user_id:
            # Another user holds the lock
            return LockDeniedResponse(
                granted=False,
                lock_holder_user_id=state["lock_holder_user_id"],
                locked_at=state.get("locked_at"),
            )

        # Same user - session transfer
        # Old connection will be notified via WebSocket
        old_connection_id = state.get("active_connection_id")
        if old_connection_id:
            await ws_manager.notify_session_transferred(old_connection_id)

    # Generate new connection ID for this session
    connection_id = ws_manager.generate_connection_id()

    # Acquire/update lock
    await repo.acquire_lock(
        video_id=video_id,
        db_name=db.value,
        user_id=auth.user_id,
        connection_id=connection_id,
        tenant_id=auth.tenant_id,
    )

    # Check if we have a working copy on disk
    needs_download = not cr_manager.has_working_copy(auth.tenant_id, video_id, db.value)

    # Get versions
    server_version = 0
    wasabi_version = 0
    if state:
        server_version = state.get("server_version", 0)
        wasabi_version = state.get("wasabi_version", 0)

    # Build WebSocket URL
    # Use the configured API host or default
    api_host = settings.api_host if settings.api_host != "0.0.0.0" else "localhost"
    ws_protocol = "wss" if settings.environment == "production" else "ws"
    websocket_url = f"{ws_protocol}://{api_host}:{settings.api_port}/v1/videos/{video_id}/sync/{db.value}"

    return LockGrantedResponse(
        granted=True,
        websocket_url=websocket_url,
        needs_download=needs_download,
        server_version=server_version,
        wasabi_version=wasabi_version,
    )


@router.delete("/{video_id}/database/{db}/lock", response_model=LockReleaseResponse)
async def release_lock(video_id: str, db: DatabaseName, auth: Auth):
    """Release editing lock.

    Only the lock holder can release the lock.
    Lock is also auto-released on idle timeout.
    """
    repo = DatabaseStateRepository()

    state = await repo.get_state(video_id, db.value)

    # Only lock holder can release
    if state and state.get("lock_holder_user_id") == auth.user_id:
        await repo.release_lock(video_id, db.value)
        return LockReleaseResponse(released=True)

    return LockReleaseResponse(released=False)


@router.post("/{video_id}/database/{db}/ensure-state")
async def ensure_database_state(video_id: str, db: DatabaseName, auth: Auth):
    """Ensure database state record exists (for new videos).

    Creates initial state if not exists. Used during video setup.
    """
    repo = DatabaseStateRepository()
    state = await repo.get_or_create_state(video_id, db.value, auth.tenant_id)

    return {
        "video_id": video_id,
        "database_name": db.value,
        "server_version": state.get("server_version", 0),
        "wasabi_version": state.get("wasabi_version", 0),
    }
