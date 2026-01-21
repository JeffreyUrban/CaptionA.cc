# CR-SQLite Implementation Plan: Layout Annotation Phase

## Overview

Enable CR-SQLite sync for the layout annotation workflow. The frontend downloads `layout.db.gz` from Wasabi and works independently; backend downloads database and initiates sync via WebSocket only after the user makes edits, the backend then responds to client edits with its own edits (i.e. running the model on the updated annotations). 

## Current State

| Component | Status | Issue |
|-----------|--------|-------|
| Backend `crsqlite_manager.py` | Implemented | Missing `site_id` filter in `get_changes_since()` |
| Backend `websocket_sync.py` | Implemented | Ready to use |
| Frontend `crsqlite-client.ts` | Uses sql.js | Need to enable @vlcn.io/crsqlite-wasm |
| Frontend `database-store.ts` | Sync disabled | Lines 274-288 commented out |
| Pipeline `modal_inference.py` | Schema issues | Missing DEFAULT values on NOT NULL columns |

## Implementation Phases

### Phase 1: Fix Schema in Data Pipeline

**File:** `data-pipelines/extract-full-frames-and-ocr/src/extract_full_frames_and_ocr/modal_inference.py`

Update the `boxes` table schema (lines 286-302) to add DEFAULT values:

```sql
CREATE TABLE boxes (
    frame_index INTEGER NOT NULL,
    box_index INTEGER NOT NULL,
    bbox_left REAL NOT NULL DEFAULT 0.0,
    bbox_top REAL NOT NULL DEFAULT 0.0,
    bbox_right REAL NOT NULL DEFAULT 0.0,
    bbox_bottom REAL NOT NULL DEFAULT 0.0,
    text TEXT DEFAULT NULL,
    label TEXT DEFAULT NULL,
    label_updated_at TEXT DEFAULT NULL,
    predicted_label TEXT DEFAULT NULL,
    predicted_confidence REAL DEFAULT NULL,
    PRIMARY KEY (frame_index, box_index)
) WITHOUT ROWID
```

Update `layout_config` table (lines 330-345) to add DEFAULT values for frame dimensions:

```sql
CREATE TABLE layout_config (
    id INTEGER NOT NULL PRIMARY KEY CHECK(id = 1),
    frame_width INTEGER NOT NULL DEFAULT 0,
    frame_height INTEGER NOT NULL DEFAULT 0,
    crop_left REAL NOT NULL DEFAULT 0,
    crop_top REAL NOT NULL DEFAULT 0,
    crop_right REAL NOT NULL DEFAULT 1,
    crop_bottom REAL NOT NULL DEFAULT 1,
    anchor_type TEXT DEFAULT NULL,
    anchor_position REAL DEFAULT NULL,
    vertical_center REAL DEFAULT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

**Note:** `preferences` table already has proper defaults.

---

### Phase 2: Add Lazy CRR Initialization to Backend

**File:** `services/api/app/services/crsqlite_manager.py`

The data pipeline uses standard `sqlite3` which cannot load extensions. Add lazy CRR initialization when the backend first opens a database.

Add method to `CRSqliteManager`:

```python
def _ensure_crr_initialized(self, conn: apsw.Connection) -> None:
    """Initialize tables as CRRs if not already done."""
    try:
        # Check if crsql_changes exists (indicates CRR already initialized)
        conn.execute("SELECT 1 FROM crsql_changes LIMIT 1").fetchone()
    except apsw.SQLError:
        # crsql_changes doesn't exist - initialize CRRs
        conn.execute("SELECT crsql_as_crr('boxes')")
        conn.execute("SELECT crsql_as_crr('layout_config')")
        conn.execute("SELECT crsql_as_crr('preferences')")
        logger.info("Initialized CRR tables")
```

Call this in `get_connection()` after loading extension (around line 179).

---

### Phase 3: Add site_id Filter to Backend

**File:** `services/api/app/services/crsqlite_manager.py`

Update `get_changes_since()` (lines 251-298) to support filtering by site_id:

```python
async def get_changes_since(
    self,
    tenant_id: str,
    video_id: str,
    db_name: str,
    since_version: int,
    exclude_site_id: bytes | None = None,  # NEW
) -> list[ChangeRecord]:
```

Update the query (line 273-281):

```python
if exclude_site_id:
    rows = cursor.execute(
        """
        SELECT "table", "pk", "cid", "val", "col_version",
               "db_version", "site_id", "cl", "seq"
        FROM crsql_changes
        WHERE db_version > ? AND site_id IS NOT ?
        ORDER BY db_version, seq
        """,
        (since_version, exclude_site_id),
    ).fetchall()
else:
    # Existing query for server-initiated pushes (no filter)
    rows = cursor.execute(
        """
        SELECT "table", "pk", "cid", "val", "col_version",
               "db_version", "site_id", "cl", "seq"
        FROM crsql_changes
        WHERE db_version > ?
        ORDER BY db_version, seq
        """,
        (since_version,),
    ).fetchall()
```

---

### Phase 4: Enable CR-SQLite in Frontend

**File:** `apps/captionacc-web/app/services/crsqlite-client.ts`

#### 4.1: Replace sql.js with @vlcn.io/crsqlite-wasm

In `CRSQLiteDatabase.open()` (lines 240-318), replace sql.js usage:

```typescript
static async open(config: DatabaseConfig): Promise<CRSQLiteDatabase> {
  await initializeSQLite()

  if (!sqlite3Instance) {
    throw databaseInitError(config.dbName, new Error('SQLite not initialized'))
  }

  const instance = new CRSQLiteDatabase(config)

  try {
    if (config.data && config.data.length > 0) {
      // Validate SQLite header
      const header = new TextDecoder().decode(config.data.slice(0, 16))
      if (!header.startsWith('SQLite format 3')) {
        throw new Error(`Invalid SQLite database header: ${header}`)
      }

      // Open using @vlcn.io/crsqlite-wasm
      instance.dbInstance = await sqlite3Instance.open()

      // Deserialize the database bytes
      await instance.dbInstance.exec('SELECT 1') // Ensure connection ready
      // Use the wasm API to load the database from bytes
      // The exact API depends on @vlcn.io/crsqlite-wasm version

      instance.db = 1 // Handle for compatibility checks

      // Initialize CRR tables (idempotent - safe to call if already done)
      await instance.ensureCrrInitialized()
    }

    await instance.initializeMetadata()
    // ... rest of initialization
  }
}
```

#### 4.2: Add CRR initialization method

```typescript
private async ensureCrrInitialized(): Promise<void> {
  try {
    await this.query('SELECT 1 FROM crsql_changes LIMIT 1')
  } catch {
    // Initialize CRRs
    await this.exec("SELECT crsql_as_crr('boxes')")
    await this.exec("SELECT crsql_as_crr('layout_config')")
    await this.exec("SELECT crsql_as_crr('preferences')")
    console.log('[CRSQLite] Initialized CRR tables')
  }
}
```

#### 4.3: Enable CR-SQLite metadata

Uncomment lines 337-354 in `initializeMetadata()`:

```typescript
private async initializeMetadata(): Promise<void> {
  // Get site ID
  const siteIdResult = await this.query<{ site_id: Uint8Array }>(
    'SELECT crsql_site_id() as site_id'
  )
  if (siteIdResult.rows[0]) {
    this._siteId = siteIdResult.rows[0].site_id
  }

  // Get current version
  const versionResult = await this.query<{ version: number }>(
    'SELECT crsql_db_version() as version'
  )
  if (versionResult.rows[0]) {
    this._version = versionResult.rows[0].version
  }
}
```

#### 4.4: Update query/exec methods

Replace sql.js API calls in `exec()` (lines 387-432) and `query()` (lines 462-581) with @vlcn.io/crsqlite-wasm API calls. Remove the `sqlJsDb` property and all sql.js-specific code paths.

---

### Phase 5: Re-enable WebSocket Sync

**File:** `apps/captionacc-web/app/stores/database-store.ts`

Uncomment lines 274-288 in `initializeDatabase()`:

```typescript
// Set up WebSocket sync
await get().setupSync(instanceId, database)

// Acquire lock if requested
if (options.acquireLock) {
  try {
    const lockStatus = await acquireLock(videoId, dbName)
    get().setLockStatus(instanceId, lockStatus)
  } catch (error) {
    console.warn(`[DatabaseStore] Failed to acquire lock:`, error)
    const lockCheck = await checkLockState(videoId, dbName)
    get().setLockStatus(instanceId, lockCheck)
  }
}
```

---

### Phase 6: Update WebSocket Handler to Pass site_id

**File:** `services/api/app/routers/websocket_sync.py`

In `handle_sync_message()`, extract the client's site_id from changes and pass it for filtering when pushing server changes back:

```python
# Extract client site_id from first change
client_site_id = None
if changes:
    client_site_id = changes[0].get("site_id")

# When pushing server changes to client, exclude client's own changes
server_changes = await cr_manager.get_changes_since(
    tenant_id=tenant_id,
    video_id=video_id,
    db_name=db_name,
    since_version=last_push_version,
    exclude_site_id=client_site_id,  # Avoid echo
)
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `data-pipelines/.../modal_inference.py` | Add DEFAULT values to schema |
| `services/api/app/services/crsqlite_manager.py` | Add CRR init, site_id filter |
| `services/api/app/routers/websocket_sync.py` | Pass site_id to get_changes_since |
| `apps/captionacc-web/app/services/crsqlite-client.ts` | Enable @vlcn.io/crsqlite-wasm, remove sql.js |
| `apps/captionacc-web/app/stores/database-store.ts` | Uncomment sync/lock code |

---

## Verification

1. **Schema Test:** Create a new video through the pipeline, verify layout.db has correct DEFAULT values
2. **CRR Test:** Open database in backend, verify `crsql_changes` table exists
3. **Frontend Test:** Load layout.db in browser, verify `crsql_site_id()` returns valid ID
4. **Sync Test:** Make annotation change, verify WebSocket sends changes and receives ack
5. **Bidirectional Test:** Trigger server prediction, verify client receives `server_update` message

---

## Migration for Existing Databases

^ No migration needed. We can remove any existing databases and start fresh. 

---

## Rollback Strategy

^ No rollback needed. We'll make this work. 