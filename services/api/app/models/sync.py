"""Models for CR-SQLite sync protocol."""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel


class DatabaseName(str, Enum):
    """Syncable database names."""

    LAYOUT = "layout"
    CAPTIONS = "captions"


class LockType(str, Enum):
    """Lock type for database editing."""

    CLIENT = "client"
    SERVER = "server"


# =============================================================================
# REST Endpoint Models
# =============================================================================


class DatabaseStateResponse(BaseModel):
    """Response for GET /database/{db}/state."""

    server_version: int
    wasabi_version: int
    wasabi_synced: bool
    lock_holder_user_id: str | None
    lock_holder_is_you: bool
    lock_type: LockType | None
    locked_at: datetime | None


class LockGrantedResponse(BaseModel):
    """Response when lock is granted."""

    granted: Literal[True]
    websocket_url: str
    needs_download: bool
    server_version: int


class LockDeniedResponse(BaseModel):
    """Response when lock is denied (another user holds it)."""

    granted: Literal[False]
    lock_holder_user_id: str
    locked_at: datetime


class LockReleaseResponse(BaseModel):
    """Response for DELETE /database/{db}/lock."""

    released: bool


class DownloadUrlResponse(BaseModel):
    """Response for GET /database/{db}/download-url."""

    url: str
    expires_in: int
    version: int


class S3CredentialsInfo(BaseModel):
    """Temporary AWS credentials for S3 access."""

    access_key_id: str
    secret_access_key: str
    session_token: str


class S3CredentialsResponse(BaseModel):
    """Response for GET /s3-credentials.

    Provides temporary credentials for direct Wasabi S3 access
    scoped to the tenant's client/ paths (read-only).
    """

    credentials: S3CredentialsInfo
    expiration: datetime
    bucket: str
    region: str
    endpoint: str
    prefix: str  # e.g. "{tenant_id}/videos/*/client/"


# =============================================================================
# WebSocket Message Models
# =============================================================================


class SyncChange(BaseModel):
    """A single CR-SQLite change record."""

    table: str
    pk: str  # base64 encoded primary key
    cid: str  # column name
    val: str | int | float | bool | None  # new value
    col_version: int
    db_version: int
    site_id: str  # base64 encoded site identifier
    cl: int  # causal length
    seq: int  # sequence number


class ClientSyncMessage(BaseModel):
    """Message from client to server: sync changes."""

    type: Literal["sync"]
    db: DatabaseName
    changes: list[SyncChange]
    client_version: int


class ServerAckMessage(BaseModel):
    """Server acknowledgment of applied changes."""

    type: Literal["ack"]
    server_version: int
    applied_count: int


class ServerUpdateMessage(BaseModel):
    """Server pushing changes to client (bidirectional sync)."""

    type: Literal["server_update"]
    db: DatabaseName
    changes: list[SyncChange]
    server_version: int


class LockChangedMessage(BaseModel):
    """Notification that lock type changed."""

    type: Literal["lock_changed"]
    lock_type: LockType
    message: str


class SessionTransferredMessage(BaseModel):
    """Notification that session moved to another tab/window."""

    type: Literal["session_transferred"]
    message: str = "Editing moved to another window"


class ErrorMessage(BaseModel):
    """Error response for sync issues."""

    type: Literal["error"]
    code: str  # INVALID_FORMAT, DB_NOT_FOUND, WORKFLOW_LOCKED, SESSION_TRANSFERRED
    message: str


# Union type for all server messages
ServerMessage = (
    ServerAckMessage
    | ServerUpdateMessage
    | LockChangedMessage
    | SessionTransferredMessage
    | ErrorMessage
)
