# CR-SQLite Sync Protocol Reference

This document describes the WebSocket sync protocol for client-facing SQLite databases using CR-SQLite (Conflict-free Replicated SQLite).

## Overview

CaptionA.cc uses CR-SQLite to synchronize client-facing databases (`layout.db`, `captions.db`) between the browser and server. The protocol provides:

- **Instant local edits**: Changes apply immediately in the browser
- **Automatic conflict resolution**: CRDT-based merging with last-writer-wins semantics
- **Efficient sync**: Only changed rows transmitted, not full database
- **Offline resilience**: Brief disconnections don't lose work
- **Durable writes**: Client changes persisted to server disk before acknowledgment

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CR-SQLite Sync Architecture                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Browser                         Server                      Wasabi S3     │
│   ───────                         ──────                      ─────────     │
│                                                                              │
│   ┌─────────────────┐            ┌─────────────────┐                        │
│   │   wa-sqlite     │            │   Python API    │                        │
│   │  + CR-SQLite    │◄── WS ────►│  + CR-SQLite    │                        │
│   │    extension    │            │    extension    │                        │
│   └────────┬────────┘            └────────┬────────┘                        │
│            │                              │                                 │
│            │                              ▼                                 │
│            │                     ┌─────────────────┐      ┌──────────────┐  │
│            │                     │  Working Copy   │      │  layout.db   │  │
│            │                     │  (local disk)   │ ───► │  captions.db │  │
│            │                     │  /var/data/...  │      │  (cold)      │  │
│            │                     └─────────────────┘      └──────────────┘  │
│            │                              │                      ▲          │
│            │                              │  Periodic upload     │          │
│            │                              │  (idle/checkpoint)   │          │
│            │                              └──────────────────────┘          │
│            │                                                     │          │
│            └─────────────────────────────────────────────────────┘          │
│                        Initial download (if needsDownload=true)             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Storage Model

| Layer | Purpose | Update Frequency |
|-------|---------|------------------|
| **Browser** | Instant local edits | Every user action |
| **Server working copy** | Durable storage during session | Every sync (to local disk) |
| **Wasabi S3** | Cold storage, corruption recovery | Periodic (idle/checkpoint/shutdown) |

**Key principles:**
- Wasabi is updated infrequently to reduce traffic
- Server working copy on local disk provides durability
- S3 versioning enabled for corruption recovery
- **Gzip compression** for Wasabi storage (60-70% size reduction, faster transfers)

## Database Sync Directions

| Database | Direction | When                                                  |
|----------|-----------|-------------------------------------------------------|
| `layout.db` | **Bidirectional** | Client: annotations. Server: predictions, crop region |
| `captions.db` | **Client → Server** | During caption workflow (client editing)              |

**Key principle:** Client and server never write the same columns simultaneously. Workflow locks enforce this separation.

---

## Client Setup

### Browser Stack

```
┌──────────────────────────────────────┐
│          Application Code            │
├──────────────────────────────────────┤
│        SQL Query Interface           │
├──────────────────────────────────────┤
│            wa-sqlite                 │  ← WebAssembly SQLite
│    + @aspect-build/aspect-sqlite     │
├──────────────────────────────────────┤
│         CR-SQLite Extension          │  ← CRDT change tracking
│       (@aspect-build/aspect-sqlite   │
│           cr-sqlite extension)       │
└──────────────────────────────────────┘
```

### Connection Flow

```typescript
// 1. Check database state and acquire lock
const state = await api.get(`/videos/${videoId}/database/${dbName}/state`);

if (state.lockHolderUserId && state.lockHolderUserId !== currentUserId) {
  // Another user has lock - show read-only or wait
  showReadOnlyMode(state.lockHolderUserId);
  return;
}

if (state.lockHolderUserId === currentUserId) {
  // Same user, different session - automatic handoff
  // Old session will receive "session_transferred" via WebSocket
}

// 2. Acquire lock (or confirm handoff)
const lockResult = await api.post(`/videos/${videoId}/database/${dbName}/lock`);
// lockResult: { granted: true, websocketUrl: "wss://...", needsDownload: true }

// 3. Load wa-sqlite with CR-SQLite extension
const db = await loadWaSqlite();
await db.loadExtension('crsqlite');

// 4. Get database content
if (lockResult.needsDownload) {
  // No server working copy - download from Wasabi using STS credentials
  const s3Key = `${tenantId}/client/videos/${videoId}/${dbName}.db.gz`;
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: "captionacc-prod",
    Key: s3Key
  }));
  const compressedBuffer = await response.Body.transformToByteArray();

  // Decompress (modern browsers support DecompressionStream)
  const decompressed = await decompressGzip(compressedBuffer);
  await db.deserialize(dbName, decompressed);
  // lockResult.wasabiVersion tells us which version we downloaded
} else {
  // Server has working copy - will receive current state via WebSocket
}

// Helper: decompress gzip using native browser API
async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buffer).body!
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

// 5. Initialize CR-SQLite on tables
await db.exec("SELECT crsql_as_crr('boxes')");
await db.exec("SELECT crsql_as_crr('layout_config')");
await db.exec("SELECT crsql_as_crr('preferences')");

// 6. Get current db_version for sync baseline
const [[version]] = await db.exec("SELECT crsql_db_version()");
let lastSyncVersion = version;

// 7. Connect WebSocket for sync
const ws = new WebSocket(lockResult.websocketUrl);
```

### Session Handoff (Same User, New Tab)

When the same user opens a new tab/window:

```
Tab A (existing)                Tab B (new)                    Server
─────────────────              ─────────────────              ──────

                               POST /database/lock ──────────►
                                                              Check: same user
                                                              Update active_connection_id
◄─────────────────────────────────────────────────────────────
{ type: "session_transferred" }
                               ◄─────────────────────────────
                               { granted: true, needsDownload: false }

Become read-only               Connect WebSocket
Show "Moved to other window"   Receive current state
                               Continue editing
```

No upload to Wasabi occurs - the same server working copy is used.

---

## CR-SQLite Change Tracking

CR-SQLite automatically tracks changes via the `crsql_changes` virtual table.

### crsql_changes Schema

| Column | Type | Description |
|--------|------|-------------|
| `table` | TEXT | Table name |
| `pk` | BLOB | Primary key (encoded) |
| `cid` | TEXT | Column name |
| `val` | ANY | New value |
| `col_version` | INTEGER | Column version (for conflict resolution) |
| `db_version` | INTEGER | Database version when change occurred |
| `site_id` | BLOB | Unique site identifier |
| `cl` | INTEGER | Causal length (for ordering) |
| `seq` | INTEGER | Sequence number |

### Querying Changes

```sql
-- Get all changes since last sync
SELECT "table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq"
FROM crsql_changes
WHERE db_version > ?;
```

### Applying Remote Changes

```sql
-- Apply changes from server
INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
```

---

## WebSocket Protocol

### Connection

```
wss://api.captionacc.com/sync/{video_id}?db={database}

Parameters:
  video_id: UUID of the video
  db: "layout" or "captions"

Headers:
  Authorization: Bearer {jwt_token}
```

### Message Format

All messages are JSON-encoded:

```typescript
interface SyncMessage {
  type: "sync" | "ack" | "error" | "lock_changed" | "server_update" | "session_transferred";
  // ... type-specific fields
}
```

### Message Types

#### Client → Server: `sync`

Send local changes to server:

```json
{
  "type": "sync",
  "db": "layout",
  "changes": [
    {
      "table": "boxes",
      "pk": "base64_encoded_pk",
      "cid": "label",
      "val": "in",
      "col_version": 5,
      "db_version": 42,
      "site_id": "base64_site_id",
      "cl": 1,
      "seq": 0
    }
  ],
  "client_version": 42
}
```

#### Server → Client: `ack`

Acknowledge successful sync:

```json
{
  "type": "ack",
  "server_version": 43,
  "applied_count": 1
}
```

#### Server → Client: `error`

Report sync error:

```json
{
  "type": "error",
  "code": "WORKFLOW_LOCKED",
  "message": "Server is processing, client writes disabled"
}
```

#### Server → Client: `lock_changed`

Notify workflow lock state change:

```json
{
  "type": "lock_changed",
  "lock_state": "SERVER_PROCESSING",
  "message": "ML predictions in progress"
}
```

#### Server → Client: `server_update`

Push server-side changes to client (bidirectional sync):

```json
{
  "type": "server_update",
  "db": "layout",
  "changes": [
    {
      "table": "boxes",
      "pk": "base64_encoded_pk",
      "cid": "predicted_label",
      "val": "in",
      "col_version": 6,
      "db_version": 44,
      "site_id": "base64_server_site_id",
      "cl": 2,
      "seq": 0
    }
  ],
  "server_version": 44
}
```

#### Server → Client: `session_transferred`

Notify that editing has moved to another tab/window (same user):

```json
{
  "type": "session_transferred",
  "message": "Editing moved to another window"
}
```

Client should become read-only. No data is lost - the same server working copy continues.

---

## Sync Flow

### Client Edit Flow

```
Client                                    Server                        Wasabi
──────                                    ──────                        ──────

1. User edits box label
   UPDATE boxes SET label='in' WHERE id=5
   (instant local update)

2. Query crsql_changes
   SELECT * FROM crsql_changes
   WHERE db_version > 41

3. Send sync message ──────────────────────►
   { type: "sync", changes: [...] }
                                          4. Validate changes
                                             - Check lock ownership
                                             - Check active_connection_id
                                             - Verify write permissions

                                          5. Apply to working copy (local disk)
                                             INSERT INTO crsql_changes ...
                                             COMMIT (fsync)

                                          6. Increment server_version
                                             Update last_activity_at

◄────────────────────────────────────────  7. Send ack
   { type: "ack", server_version: 42 }

8. Update lastSyncVersion = 42

                                          (Later: idle timeout or checkpoint)
                                          ─────────────────────────────────────►
                                                                    Upload to Wasabi
                                                                    Update wasabi_version
```

**Durability:** Client change is persisted to server disk before ack. Wasabi upload is deferred.

### Server Prediction Flow (Bidirectional)

```
Client                                    Server                        Wasabi
──────                                    ──────                        ──────

                                          1. ML model runs predictions
                                             UPDATE boxes SET
                                               predicted_label='in',
                                               predicted_confidence=0.95
                                             WHERE id=5

                                          2. Query changes
                                             SELECT * FROM crsql_changes
                                             WHERE db_version > last_push

◄────────────────────────────────────────  3. Push server_update
   { type: "server_update", changes: [...] }

4. Apply changes locally
   INSERT INTO crsql_changes ...

5. UI updates instantly
                                          (Later: periodic upload)
                                          ─────────────────────────────────────►
```

---

## Locking

Lock state is stored in Supabase `video_database_state` table. See [Supabase Schema Reference](./supabase-schema.md#video_database_state).

### Lock Model

**Lock is user-level, not session-level.** A user can have only one active editing session per database, but can transparently switch between browser tabs/windows.

| Field | Purpose |
|-------|---------|
| `lock_holder_user_id` | User who owns the lock |
| `lock_type` | 'client' or 'server' |
| `active_connection_id` | Which WebSocket connection can write (for routing) |

### Lock Types

| Type | Who can write | When |
|------|---------------|------|
| `client` | User via WebSocket | User is editing |
| `server` | Server processes | ML predictions, OCR processing |
| `NULL` | Nobody (released) | No active session |

### Lock Transitions

```
                        ┌──────────────────────┐
                        │                      │
         ┌──────────────┤   lock_type=client   │◄───────────────┐
         │              │                      │                │
         │              └──────────────────────┘                │
         │                        │                             │
         │                        │ Server needs to             │
         │                        │ run ML/OCR                  │
         │                        ▼                             │
         │              ┌──────────────────────┐                │
         │              │                      │                │
         │              │  lock_type=server    │────────────────┘
         │              │                      │   Server done
         │              └──────────────────────┘
         │
         │ Idle timeout / User leaves
         ▼
┌──────────────────────┐
│   lock_type=NULL     │  Lock released, eligible for Wasabi upload
└──────────────────────┘
```

### Client Lock Handling

```typescript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "lock_changed") {
    if (msg.lock_type === "server") {
      // Server took lock - disable editing UI
      setReadOnly(true);
      showNotification("Server is processing...");
    } else if (msg.lock_type === "client") {
      // Lock returned to client - re-enable editing
      setReadOnly(false);
      // Re-sync to get server changes
      await pullServerChanges();
    }
  }

  if (msg.type === "session_transferred") {
    // Another tab took over
    setReadOnly(true);
    showNotification("Editing moved to another window");
  }
};
```

---

## Wasabi Upload Strategy

Wasabi is cold storage updated infrequently. Upload only when there are actual changes (`server_version > wasabi_version`).

### Compression

All database files are gzip compressed before upload:

| Database | Typical Size | Compressed | Reduction |
|----------|--------------|------------|-----------|
| layout.db | 0.5-5 MB | 0.2-2 MB | ~60-70% |
| captions.db | 0.1-2 MB | 0.04-0.8 MB | ~60-70% |

**Storage path:** Files stored with `.gz` extension: `{tenant_id}/{video_id}/layout.db.gz`

```python
import gzip

async def upload_to_wasabi(working_path: Path, video_id: str, db_name: str):
    # Compress before upload
    with open(working_path, 'rb') as f:
        compressed = gzip.compress(f.read(), compresslevel=6)

    key = f"{tenant_id}/{video_id}/{db_name}.db.gz"
    await s3.put_object(
        Bucket="captionacc-prod",
        Key=key,
        Body=compressed,
        ContentType="application/gzip"
    )
```

### Upload Triggers

| Trigger | Condition | Notes |
|---------|-----------|-------|
| **Idle timeout** | No activity for N minutes | e.g., 5 minutes |
| **Periodic checkpoint** | Every M minutes | e.g., 15 minutes; timer resets on any upload |
| **Server shutdown** | SIGTERM received | Upload all working copies with unsaved changes |
| **Workflow exit** | User navigates to different video | Lock released, changes saved |

### NOT Upload Triggers

- Individual sync operations (too frequent)
- WebSocket disconnect (let idle timeout handle it)
- Session transfer to same user (no change to data)
- Periodic heartbeat (no change to data)

### Background Worker

```python
# Runs every minute
async def sync_idle_databases():
    idle_threshold = timedelta(minutes=5)
    checkpoint_threshold = timedelta(minutes=15)

    # Find databases with unsaved changes
    pending = await db.fetch("""
        SELECT * FROM video_database_state
        WHERE server_version > wasabi_version
          AND (
            last_activity_at < NOW() - $1  -- Idle
            OR wasabi_synced_at < NOW() - $2  -- Checkpoint overdue
          )
    """, idle_threshold, checkpoint_threshold)

    for state in pending:
        await upload_to_wasabi(state)
        await db.execute("""
            UPDATE video_database_state
            SET wasabi_version = server_version,
                wasabi_synced_at = NOW()
            WHERE video_id = $1 AND database_name = $2
        """, state.video_id, state.database_name)
```

### Server Shutdown Handler

```python
import signal

async def graceful_shutdown(signum, frame):
    # Upload all databases with unsaved changes
    pending = await db.fetch("""
        SELECT * FROM video_database_state
        WHERE server_version > wasabi_version
    """)

    for state in pending:
        await upload_to_wasabi(state)

    sys.exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
```

### Corruption Recovery

S3 versioning is enabled on the Wasabi bucket. Each PUT creates a new version, preserving history.

```bash
# List versions of a database
aws s3api list-object-versions \
  --bucket captionacc-prod \
  --prefix "tenant-id/video-id/layout.db"

# Restore previous version
aws s3api copy-object \
  --bucket captionacc-prod \
  --copy-source "captionacc-prod/tenant-id/video-id/layout.db?versionId=xxx" \
  --key "tenant-id/video-id/layout.db"
```

---

## Conflict Resolution

CR-SQLite uses **last-writer-wins** (LWW) with Lamport timestamps for conflict resolution.

### How It Works

1. Each change has a `col_version` (Lamport timestamp)
2. When changes conflict, higher `col_version` wins
3. If `col_version` ties, `site_id` is used as tiebreaker

### Column Separation

In practice, conflicts are rare because:

- Client and server write to **different columns**
- Workflow locks prevent simultaneous edits to same data
- Each user has unique `site_id`

| Table | Client Columns | Server Columns |
|-------|----------------|----------------|
| `boxes` | `label`, `label_updated_at` | `predicted_label`, `predicted_confidence` |
| `layout_config` | — | all columns |
| `captions` | `text`, `text_status`, `text_notes`, `caption_frame_extents_state` (confirmed) | `caption_frame_extents_state` (predicted), `caption_ocr` |

---

## Error Handling

### Client-Side Errors

| Error | Recovery |
|-------|----------|
| WebSocket disconnect | Reconnect with exponential backoff, re-sync from lastSyncVersion |
| Sync rejected (lock) | Queue changes locally, retry when lock released |
| Invalid changes | Log error, notify user, discard invalid change |

### Server-Side Errors

| Error | Response |
|-------|----------|
| Invalid JSON | `{ type: "error", code: "INVALID_FORMAT" }` |
| Unauthorized | Close connection with 4001 |
| Database not found | `{ type: "error", code: "DB_NOT_FOUND" }` |
| Workflow locked | `{ type: "error", code: "WORKFLOW_LOCKED" }` |
| Session transferred | `{ type: "error", code: "SESSION_TRANSFERRED" }` |

### Reconnection Strategy

```typescript
let reconnectAttempts = 0;
const maxAttempts = 10;
const baseDelay = 1000;

function reconnect() {
  if (reconnectAttempts >= maxAttempts) {
    showError("Connection lost. Please refresh.");
    return;
  }

  const delay = baseDelay * Math.pow(2, reconnectAttempts);
  setTimeout(() => {
    reconnectAttempts++;
    connectWebSocket();
  }, delay);
}

ws.onclose = reconnect;
```

---

## Performance Considerations

### Batching Changes

For rapid edits (e.g., rectangle select), batch changes before sending:

```typescript
let pendingChanges = [];
let syncTimeout = null;

function queueChange(change) {
  pendingChanges.push(change);

  // Debounce: send after 100ms of no new changes
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(sendChanges, 100);
}

function sendChanges() {
  if (pendingChanges.length === 0) return;

  ws.send(JSON.stringify({
    type: "sync",
    changes: pendingChanges
  }));

  pendingChanges = [];
}
```

### Large Sync Payloads

For initial sync or after long offline period:

1. Server may send changes in chunks
2. Each chunk includes `has_more: true` until final chunk
3. Client applies chunks sequentially

---

## Security

### Authentication

- WebSocket connections require valid JWT in query param or header
- JWT validated on connection and periodically
- Connection closed on token expiration

### Authorization

- User must have access to video (via Supabase RLS)
- Workflow lock state checked before applying changes
- Server validates column-level write permissions

### Data Validation

Server validates all incoming changes:

- Table exists and is sync-enabled
- Column exists and is writable by client
- Value types match schema
- Frame indices are within bounds

---

## Implementation Notes

### Server Working Copy Management

Working copies are stored on local disk for durability:

```
/var/data/captionacc/working/
└── {tenant_id}/{video_id}/
    ├── layout.db
    └── captions.db
```

**SQLite configuration for crash safety:**

```python
# WAL mode for concurrent reads + crash safety
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA synchronous=NORMAL")  # Safe with WAL
```

**Acquiring a working copy:**

```python
import gzip

async def download_from_wasabi(video_id: str, db_name: str, dest_path: Path):
    """Download and decompress database from Wasabi."""
    key = f"{tenant_id}/{video_id}/{db_name}.db.gz"
    response = await s3.get_object(Bucket="captionacc-prod", Key=key)
    compressed = await response['Body'].read()

    # Decompress and write to disk
    decompressed = gzip.decompress(compressed)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_bytes(decompressed)

async def acquire_working_copy(video_id: str, db_name: str) -> Path:
    state = await get_database_state(video_id, db_name)
    working_path = Path(f"/var/data/captionacc/working/{tenant_id}/{video_id}/{db_name}.db")

    if working_path.exists():
        # Working copy already exists (from previous session or same user)
        return working_path

    if state.wasabi_version == state.server_version:
        # Wasabi is current - download and decompress
        await download_from_wasabi(video_id, db_name, working_path)
    else:
        # This shouldn't happen - server_version > wasabi_version but no working copy
        # Recovery: treat wasabi as authoritative, log warning
        logger.warning(f"Missing working copy for {video_id}/{db_name}, downloading from Wasabi")
        await download_from_wasabi(video_id, db_name, working_path)
        await db.execute("""
            UPDATE video_database_state
            SET server_version = wasabi_version
            WHERE video_id = $1 AND database_name = $2
        """, video_id, db_name)

    # Update state
    await db.execute("""
        UPDATE video_database_state
        SET working_copy_path = $1
        WHERE video_id = $2 AND database_name = $3
    """, str(working_path), video_id, db_name)

    return working_path
```

### Server-Side Stack

```python
# Python with apsw (Another Python SQLite Wrapper)
import apsw

# Load CR-SQLite extension - use file path, not :memory:
working_path = acquire_working_copy(video_id, db_name)
conn = apsw.Connection(str(working_path))
conn.load_extension("crsqlite")

# Apply client changes (durable before ack)
for change in client_changes:
    conn.execute("""
        INSERT INTO crsql_changes
        ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, change)

# Commit ensures durability
conn.execute("COMMIT")
```

### Handling Stale Writes

Reject writes from connections that are no longer active:

```python
async def handle_sync(websocket, message):
    state = await get_database_state(video_id, db_name)

    # Check this connection is still the active writer
    if state.active_connection_id != websocket.id:
        await websocket.send({
            "type": "error",
            "code": "SESSION_TRANSFERRED",
            "message": "Editing moved to another window"
        })
        return

    # Check lock type allows client writes
    if state.lock_type != "client":
        await websocket.send({
            "type": "error",
            "code": "WORKFLOW_LOCKED",
            "message": "Server is processing"
        })
        return

    # Process sync...
```

### Server Startup Recovery

On server start, check for orphaned working copies:

```python
async def recover_orphaned_databases():
    """Upload any working copies that weren't synced to Wasabi."""
    working_dir = Path("/var/data/captionacc/working")

    for db_file in working_dir.rglob("*.db"):
        # Parse path to get tenant_id, video_id, db_name
        parts = db_file.relative_to(working_dir).parts
        tenant_id, video_id, db_filename = parts
        db_name = db_filename.replace(".db", "")

        state = await get_database_state(video_id, db_name)

        if state and state.server_version > state.wasabi_version:
            logger.info(f"Recovering orphaned database: {video_id}/{db_name}")
            await upload_to_wasabi(db_file, video_id, db_name)
            await db.execute("""
                UPDATE video_database_state
                SET wasabi_version = server_version,
                    wasabi_synced_at = NOW()
                WHERE video_id = $1 AND database_name = $2
            """, video_id, db_name)
```

### Testing Sync

```python
# Test change tracking
def test_change_tracking():
    # Make edit
    conn.execute("UPDATE boxes SET label = 'in' WHERE id = 1")

    # Verify change recorded
    changes = conn.execute("""
        SELECT * FROM crsql_changes WHERE "table" = 'boxes'
    """).fetchall()

    assert len(changes) == 1
    assert changes[0]["cid"] == "label"
    assert changes[0]["val"] == "in"
```

---

## Related Documentation

- [SQLite Database Reference](./sqlite-databases.md) - Database schemas
- [Wasabi Storage](./wasabi/) - Bucket configuration, STS credentials
- [Supabase Schema Reference](./supabase-schema.md) - `video_database_state` table for versioning and locks
- [CR-SQLite Documentation](https://github.com/vlcn-io/cr-sqlite) - Upstream library
