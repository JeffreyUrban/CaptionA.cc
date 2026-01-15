"""WebSocket endpoint for CR-SQLite sync.

Handles real-time bidirectional sync between browser and server.
"""

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from app.config import get_settings
from app.dependencies import AuthContext
from app.models.sync import DatabaseName
from app.services.crsqlite_manager import get_crsqlite_manager
from app.services.supabase_client import DatabaseStateRepository
from app.services.websocket_manager import get_websocket_manager

logger = logging.getLogger(__name__)

router = APIRouter()


async def get_websocket_auth(
    websocket: WebSocket,
    token: str,
) -> AuthContext | None:
    """Extract and validate JWT from WebSocket query param.

    Args:
        websocket: WebSocket connection
        token: JWT token from query param

    Returns:
        AuthContext if valid, None if invalid (connection will be closed)
    """
    settings = get_settings()

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )

        user_id = payload.get("sub")
        tenant_id = payload.get("tenant_id")

        if not user_id or not tenant_id:
            await websocket.close(code=4001, reason="Invalid token claims")
            return None

        return AuthContext(
            user_id=user_id,
            tenant_id=tenant_id,
            email=payload.get("email"),
        )

    except JWTError as e:
        logger.warning(f"WebSocket auth failed: {e}")
        await websocket.close(code=4001, reason="Invalid token")
        return None


@router.websocket("/{video_id}/sync/{db}")
async def websocket_sync(
    websocket: WebSocket,
    video_id: str,
    db: DatabaseName,
    token: str = Query(...),
):
    """WebSocket endpoint for real-time CR-SQLite sync.

    Flow:
    1. Client acquires lock via POST /database/{db}/lock
    2. Client downloads database from Wasabi if needed
    3. Client connects to this WebSocket with token
    4. Client sends sync messages with changes
    5. Server applies changes and sends ack
    6. Server may push changes back (bidirectional)

    Query params:
        token: JWT for authentication
    """
    ws_manager = get_websocket_manager()
    cr_manager = get_crsqlite_manager()
    state_repo = DatabaseStateRepository()

    # Authenticate
    auth = await get_websocket_auth(websocket, token)
    if auth is None:
        return

    # Verify lock ownership
    state = await state_repo.get_state(video_id, db.value)
    if not state:
        await websocket.close(code=4003, reason="Database state not found")
        return

    if state.get("lock_holder_user_id") != auth.user_id:
        await websocket.close(code=4003, reason="Lock not held by user")
        return

    connection_id = state.get("active_connection_id")
    if not connection_id:
        await websocket.close(code=4003, reason="No active connection registered")
        return

    # Ensure working copy exists
    if not cr_manager.has_working_copy(auth.tenant_id, video_id, db.value):
        try:
            await cr_manager.download_from_wasabi(auth.tenant_id, video_id, db.value)
            logger.info(f"Downloaded working copy for {video_id}/{db.value}")
        except Exception as e:
            logger.error(f"Failed to download working copy: {e}")
            await websocket.close(code=4004, reason="Failed to initialize database")
            return

    # Register connection
    session = await ws_manager.connect(
        websocket=websocket,
        connection_id=connection_id,
        tenant_id=auth.tenant_id,
        video_id=video_id,
        db_name=db.value,
        user_id=auth.user_id,
    )

    try:
        # Main message loop
        while True:
            raw_message = await websocket.receive_text()

            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await ws_manager.send_error(
                    connection_id, "INVALID_FORMAT", "Invalid JSON"
                )
                continue

            msg_type = message.get("type")

            if msg_type == "sync":
                await handle_sync_message(
                    session=session,
                    message=message,
                    ws_manager=ws_manager,
                    cr_manager=cr_manager,
                    state_repo=state_repo,
                )
            elif msg_type == "ping":
                # Heartbeat - just update activity
                ws_manager.update_activity(connection_id)
                await ws_manager.send_message(connection_id, {"type": "pong"})
            else:
                await ws_manager.send_error(
                    connection_id, "UNKNOWN_TYPE", f"Unknown message type: {msg_type}"
                )

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {connection_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await ws_manager.disconnect(connection_id)


async def handle_sync_message(
    session,
    message: dict,
    ws_manager,
    cr_manager,
    state_repo: DatabaseStateRepository,
):
    """Handle incoming sync message from client.

    Args:
        session: SyncSession for this connection
        message: Parsed sync message
        ws_manager: WebSocket manager
        cr_manager: CR-SQLite manager
        state_repo: Database state repository
    """
    connection_id = session.connection_id
    video_id = session.video_id
    db_name = session.db_name
    tenant_id = session.tenant_id

    # Verify this connection is still active writer
    state = await state_repo.get_state(video_id, db_name)

    if not state:
        await ws_manager.send_error(
            connection_id, "DB_NOT_FOUND", "Database state not found"
        )
        return

    if state.get("active_connection_id") != connection_id:
        await ws_manager.send_error(
            connection_id, "SESSION_TRANSFERRED", "Editing moved to another window"
        )
        return

    if state.get("lock_type") != "client":
        await ws_manager.send_error(
            connection_id, "WORKFLOW_LOCKED", "Server is processing"
        )
        return

    # Extract changes
    changes = message.get("changes", [])

    if changes:
        try:
            # Apply changes to working copy
            new_version = await cr_manager.apply_changes(
                tenant_id=tenant_id,
                video_id=video_id,
                db_name=db_name,
                changes=changes,
            )

            # Update state
            await state_repo.increment_server_version(video_id, db_name)
            await state_repo.update_activity(video_id, db_name)
            ws_manager.update_activity(connection_id)

            # Send ack
            await ws_manager.send_ack(
                connection_id=connection_id,
                server_version=new_version,
                applied_count=len(changes),
            )

            logger.debug(
                f"Applied {len(changes)} changes to {video_id}/{db_name}, version={new_version}"
            )

        except Exception as e:
            logger.error(f"Failed to apply changes: {e}")
            await ws_manager.send_error(
                connection_id, "APPLY_ERROR", f"Failed to apply changes: {e}"
            )
    else:
        # No changes - just ack
        current_version = state.get("server_version", 0)
        await ws_manager.send_ack(
            connection_id=connection_id,
            server_version=current_version,
            applied_count=0,
        )
