# CR-SQLite WebSocket Sync API Implementation Plan

**Status:** ✅ Complete
**CR-SQLite Source:** [superfly/cr-sqlite](https://github.com/superfly/cr-sqlite) (release: `prebuild-test.main-438663b8`)

## Overview

Implement real-time bidirectional sync for `layout.db` and `captions.db` using CR-SQLite over WebSocket, with working copy management on server disk and periodic Wasabi uploads.

## Target Endpoints (from api-endpoints.md)

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /videos/{id}/database/{db}/state` | Check version, lock status |
| 2 | `POST /videos/{id}/database/{db}/lock` | Acquire lock, get WebSocket URL |
| 3 | `GET /videos/{id}/database/{db}/download-url` | Presigned URL for .db.gz |
| 4 | `WebSocket /videos/{id}/sync/{db}` | Real-time CR-SQLite sync |
| 5 | `DELETE /videos/{id}/database/{db}/lock` | Release lock |

---

## Phase 1: Dependencies & Foundation

### 1.1 Add Dependencies

**File:** `/services/api/pyproject.toml`
```toml
dependencies = [
    # ... existing ...
    "apsw>=3.51.0",        # SQLite wrapper with extension loading
    "supabase>=2.0.0",     # Supabase client for video_database_state
]
```

### 1.2 Install CR-SQLite Extension

Download from [superfly/cr-sqlite releases](https://github.com/superfly/cr-sqlite/releases/tag/prebuild-test.main-438663b8):
- **macOS Apple Silicon:** `crsqlite-darwin-aarch64.zip` → `crsqlite.dylib`
- **macOS Intel:** `crsqlite-darwin-x86_64.zip` → `crsqlite.dylib`
- **Linux x86_64:** `crsqlite-linux-x86_64.zip` → `crsqlite.so`
- **Linux ARM64:** `crsqlite-linux-aarch64.zip` → `crsqlite.so`

Place at configured path (default: `/var/lib/captionacc/extensions/crsqlite.so`).

### 1.3 Add Config Settings

**File:** `/services/api/app/config.py` (modify)
```python
# CR-SQLite Sync
crsqlite_extension_path: str = "/var/lib/captionacc/extensions/crsqlite.so"
working_copy_dir: str = "/var/data/captionacc/working"
wasabi_upload_idle_minutes: int = 5
wasabi_upload_checkpoint_minutes: int = 15

# Supabase
supabase_service_role_key: str = ""
supabase_schema: str = "captionacc_production"
```

---

## Phase 2: New Files to Create

### 2.1 Sync Models

**File:** `/services/api/app/models/sync.py`
- `DatabaseName` enum (layout, captions)
- `LockType` enum (client, server)
- REST response models: `DatabaseStateResponse`, `LockGrantedResponse`, `LockDeniedResponse`, `DownloadUrlResponse`
- WebSocket message models: `SyncChange`, `ClientSyncMessage`, `ServerAckMessage`, `ServerUpdateMessage`, etc.

### 2.2 Supabase Client for API

**File:** `/services/api/app/services/supabase_client.py`
- `DatabaseStateRepository` class
- Methods: `get_state()`, `acquire_lock()`, `release_lock()`, `update_activity()`, `increment_server_version()`

### 2.3 CR-SQLite Working Copy Manager

**File:** `/services/api/app/services/crsqlite_manager.py`
- `CRSqliteManager` class
- Methods:
  - `download_from_wasabi()` - Download + gzip decompress
  - `upload_to_wasabi()` - Gzip compress + upload
  - `get_connection()` - Get apsw connection with crsqlite extension loaded
  - `apply_changes()` - Apply changes via `crsql_changes` table
  - `get_changes_since()` - Query changes for server→client push
  - `has_working_copy()` - Check if local file exists

### 2.4 WebSocket Connection Manager

**File:** `/services/api/app/services/websocket_manager.py`
- `SyncSession` dataclass
- `WebSocketManager` class
- Methods: `connect()`, `disconnect()`, `notify_session_transferred()`, `notify_lock_changed()`, `send_message()`

### 2.5 Background Upload Worker

**File:** `/services/api/app/services/background_tasks.py`
- `WasabiUploadWorker` class
- Runs every minute, uploads databases with:
  - Idle timeout (no activity for 5 min)
  - Checkpoint (every 15 min)
- Graceful shutdown handler uploads all pending

### 2.6 Sync REST Router

**File:** `/services/api/app/routers/sync.py`
- `GET /{video_id}/database/{db}/state`
- `POST /{video_id}/database/{db}/lock`
- `DELETE /{video_id}/database/{db}/lock`
- `GET /{video_id}/database/{db}/download-url`

### 2.7 WebSocket Sync Router

**File:** `/services/api/app/routers/websocket_sync.py`
- `WebSocket /{video_id}/sync/{db}`
- JWT auth from query param
- Handle `sync` messages, send `ack`/`error` responses
- Session transfer detection

---

## Phase 3: Modify Existing Files

### 3.1 Main App

**File:** `/services/api/app/main.py`
```python
# Add imports
from app.routers import sync, websocket_sync
from app.services.background_tasks import get_upload_worker

# In lifespan():
upload_worker = get_upload_worker()
await upload_worker.start()
yield
await upload_worker.stop()

# Register routers
app.include_router(sync.router, prefix="/videos", tags=["sync"])
app.include_router(websocket_sync.router, prefix="/videos", tags=["sync"])
```

---

## Implementation Order

1. **Phase 1** - Dependencies & config
2. **Phase 2.1-2.2** - Models & Supabase client
3. **Phase 2.3** - CRSqliteManager (core sync logic)
4. **Phase 2.6** - REST endpoints (state, lock, download-url)
5. **Phase 2.4** - WebSocket manager
6. **Phase 2.7** - WebSocket endpoint
7. **Phase 2.5** - Background upload worker
8. **Phase 3** - Wire up in main.py

---

## Critical Files

| File | Purpose |
|------|---------|
| `/services/api/app/services/crsqlite_manager.py` | Core CR-SQLite working copy management |
| `/services/api/app/routers/websocket_sync.py` | WebSocket sync endpoint |
| `/services/api/app/services/supabase_client.py` | Lock/state management |
| `/services/api/app/routers/sync.py` | REST endpoints for state/lock |
| `/services/api/app/main.py` | Router registration, lifecycle |

---

## Verification

### Manual Testing
1. Lock acquisition: `POST /videos/{id}/database/layout/lock`
2. Download URL: `GET /videos/{id}/database/layout/download-url`
3. WebSocket connect with token
4. Send sync message, verify ack
5. Open second tab, verify session transfer notification
6. Wait 5 min, verify Wasabi upload

### Unit Tests
- `tests/test_crsqlite_manager.py` - Extension loading, change application
- `tests/test_websocket_manager.py` - Session management
- `tests/test_sync_endpoints.py` - Lock flow, presigned URLs

### Integration Test
- Full round-trip: lock → download → connect WebSocket → sync changes → verify in database
