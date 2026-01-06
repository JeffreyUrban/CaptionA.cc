# Transparent Auto-Save for Annotations

## Philosophy

Auto-save should be **completely invisible** to users. No save buttons, no "draft saved" notifications, no conflict dialogs. When edge cases occur (conflicts, failures), log them for admin investigation rather than interrupting the user.

**Key Principles:**
1. **Silent saves** - No UI clutter or user interruption
2. **Change detection** - Only save when data actually changes
3. **Optimistic by default** - Assume saves succeed, log when they don't
4. **Last-write-wins** - Simple conflict resolution, accept occasional data loss
5. **Admin debugging tools** - Handle edge cases out-of-band

## User Model

**Current (B2C):** Single user per tenant
- User owns all videos in their tenant
- Conflicts only occur across devices (same user, different devices)
- Simpler permission model (user accesses everything in their tenant)

**Future (B2B):** Multiple users per tenant
- Multiple users collaborate on shared videos
- Conflicts occur across users (User A and User B editing simultaneously)
- Role-based access control within tenant

**Design Strategy:** Architecture supports both models without migration pain
- Already use `tenant_id` everywhere (enables multi-user later)
- Already track `user_id` on all modifications (enables attribution)
- Conflict resolution (last-write-wins) works for both single-user and multi-user
- Permission checks in place (currently always pass, but structure ready for B2B)

### Migration Path to B2B Multi-User

When adding multi-user support, these changes would be needed:

**Database:**
```sql
-- Add role-based access (future)
CREATE TABLE user_video_permissions (
  user_id UUID REFERENCES auth.users(id),
  video_id UUID REFERENCES videos(id),
  role TEXT CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (user_id, video_id)
);

-- Update RLS policies to check user_video_permissions
-- Currently: user can access all videos in their tenant
-- Future: user can access videos they have explicit permission to
```

**What changes:**
- ✅ RLS policies get more restrictive (add user_video_permissions check)
- ✅ Conflict notifications could notify collaborators (currently admin-only)
- ✅ UI could show "User A is editing this video" presence indicators

**What doesn't change:**
- ✅ Auto-save flow (already tracks user_id, works for multi-user)
- ✅ Conflict resolution (last-write-wins still works, just across users instead of devices)
- ✅ Version tracking (already captures who made each save)
- ✅ Storage structure (tenant_id isolation already in place)

### Anti-Patterns to Avoid (Prevent Migration Pain)

**❌ Don't assume single user in code:**
```typescript
// BAD - assumes one user per tenant
const userId = tenant.ownerId

// GOOD - works for both B2C and B2B
const userId = auth.uid()
```

**❌ Don't skip permission checks:**
```typescript
// BAD - assumes user can access everything
const video = await db.videos.findByTenant(tenantId)

// GOOD - check permissions even if currently always true
const video = await db.videos.findByUserAccess(userId, tenantId)
```

**❌ Don't hardcode tenant-wide queries:**
```typescript
// BAD - assumes user sees all tenant videos
SELECT * FROM videos WHERE tenant_id = ?

// GOOD - use RLS or explicit permission checks
SELECT * FROM videos WHERE tenant_id = ? AND user_has_access(user_id, id)
```

**✅ Do track user attribution:**
```typescript
// Already doing this - keep it!
{
  uploaded_by_user_id: userId,
  updated_by_user_id: userId,
  created_at: timestamp
}
```

---

## Storage Principles

**Critical:** Use the right storage for the job:
- **Supabase:** Relational data, search indexes, small binaries (<100 KB), frequently queried metadata
- **Wasabi:** Large files (>100 KB), accessed by key/path, not by queries

### Supabase (PostgreSQL - Structured Data & Small Binaries)
**Permanent storage:**
- Video catalog metadata (title, status, duration, upload date, etc.)
- User and tenant data
- Version numbers and timestamps
- Storage keys (pointers to Wasabi for large files)
- Status flags and state machines
- Small structured data (e.g., crop bounds JSONB - typically <1 KB)
- Thumbnails and preview images (<100 KB each)
- Cross-video search index (OCR text for full-text search)
- Permissions and access control

**Temporary storage (with migration policy):**
- Recent annotation changes (<10 KB) - migrate to Wasabi after 5 minutes
- Incremental deltas - batch and migrate daily
- Hot cache data - migrate when cold

**Rule of thumb:** Supabase is for relational queries, indexes, and small data frequently accessed in queries.

### Wasabi (S3 - Large Files & Blobs)
- Video files (original MP4/MOV/etc.)
- Database files (layout.db, captions.db, video.db, fullOCR.db)
- Cropped frame chunks (WebM/VP9 format)
- Full frame images (JPEG BLOBs inside video.db)
- Conflict snapshots
- Error state snapshots
- Migrated annotation history
- Large exports and backups

**Rule of thumb:** Wasabi is for large files (>100 KB) accessed by key/path, not queries.

### Migration Policy

**Rule:** If data in Supabase exceeds size threshold or age threshold, migrate to Wasabi.

**Thresholds:**
- Size: >10 KB per row → immediate migration
- Age: >1 hour → migrate to Wasabi, replace with pointer
- Frequency: Batch migration runs every 15 minutes

**Example:** Recent annotation changes stored temporarily in Supabase for quick access, then batched to Wasabi and replaced with storage key pointer.

---

## Two-Tier Architecture

### Tier 1: Browser State (In-Memory + IndexedDB)
**Purpose:** Instant persistence across page refreshes
**Storage:** IndexedDB
**Frequency:** Debounced 5 seconds after last change
**Scope:** Single device

### Tier 2: Server Persistence (API → Prefect → Wasabi)
**Purpose:** Cross-device sync and backup
**Storage:** Wasabi (single file, no drafts)
**Frequency:** Debounced 30 seconds after last change
**Scope:** All devices, all users

**Flow:** Browser → API endpoint → Prefect flow → Wasabi
- Browser sends JSON annotation data to API
- API queues Prefect flow with data
- Prefect creates SQLite database from JSON
- Prefect uploads to Wasabi

**Security:**
- **Downloads:** Browser gets temporary signed URLs for authorized content
- **Uploads:** Browser sends JSON to API → Prefect → Wasabi (no upload credentials in browser)

**No separation of "drafts" vs "published"** - There's only one version of layout.db or captions.db per video. When user makes changes, they're automatically persisted.

### Wasabi Storage Structure

```
{bucket}/{tenant_id}/{video_id}/
├── layout.db                          # Current version (auto-saved)
├── captions.db                        # Current version (auto-saved)
└── snapshots/                         # Conflict and error snapshots
    ├── conflict_1704672345_user1.db   # Snapshot from conflict
    ├── conflict_1704672345_user2.db   # Snapshot from conflict
    ├── error_1704672890_user1.db      # Snapshot from save error
    └── ...
```

**Note:** All actual database files stored in Wasabi. Supabase only stores metadata pointing to these files.

---

## Data Migration Flow

For data that starts in Supabase and migrates to Wasabi:

```python
# Scheduled task runs every 15 minutes
@flow(name="migrate-annotation-deltas")
def migrate_annotation_deltas_flow():
    """
    Migrate old annotation deltas from Supabase to Wasabi.

    Finds deltas older than 1 hour or larger than 10 KB,
    batches them to Wasabi, and replaces with storage key pointer.
    """
    # Find deltas that need migration
    deltas_repo = AnnotationDeltasRepository()
    deltas_to_migrate = deltas_repo.find_migration_candidates(
        age_threshold_minutes=60,
        size_threshold_bytes=10240
    )

    for video_id, deltas in group_by_video(deltas_to_migrate):
        # Batch deltas into a single database file
        batch_db_path = create_delta_batch_db(deltas)

        # Upload to Wasabi
        storage_key = upload_delta_batch(video_id, batch_db_path)

        # Replace Supabase deltas with pointer
        deltas_repo.replace_with_pointer(
            delta_ids=[d.id for d in deltas],
            storage_key=storage_key
        )

        print(f"Migrated {len(deltas)} deltas for video {video_id} to {storage_key}")
```

**Result:** Supabase stays small and fast, while Wasabi holds the permanent archive.

---

## Change Detection

Only save when data actually changes. Use content hashing to detect changes.

```typescript
class AnnotationState {
  private lastSavedHash: string = ''
  private currentState: AnnotationData
  private isDirty: boolean = false

  // Called on every annotation change
  onChange(change: AnnotationChange) {
    // Apply change to current state
    this.applyChange(change)

    // Mark as dirty (needs save)
    this.isDirty = true

    // Schedule saves (debounced)
    this.scheduleSaves()
  }

  // Check if state actually changed (content-based)
  hasChanges(): boolean {
    if (!this.isDirty) return false

    const currentHash = this.computeHash(this.currentState)
    return currentHash !== this.lastSavedHash
  }

  private computeHash(state: AnnotationData): string {
    // Hash the actual annotation data (not timestamps or metadata)
    const canonical = JSON.stringify({
      annotations: state.annotations.sort((a, b) => a.id.localeCompare(b.id)),
      // Only include fields that affect canonical data
      // Exclude: lastModified, userId, deviceId, etc.
    })
    return sha256(canonical)
  }

  private async scheduleSaves() {
    // Debounced IndexedDB save (5 seconds)
    this.debounce('indexdb', () => this.saveToIndexedDB(), 5000)

    // Debounced server save (30 seconds)
    this.debounce('server', () => this.saveToServer(), 30000)
  }

  private async saveToIndexedDB() {
    if (!this.hasChanges()) return // Skip if no actual changes

    try {
      await this.indexedDBService.save(this.currentState)
      this.lastSavedHash = this.computeHash(this.currentState)
      this.isDirty = false
    } catch (error) {
      // Log but don't bother user
      console.error('[Auto-Save] IndexedDB save failed:', error)
      this.reportToAdmin('indexdb_save_failed', error)
    }
  }

  private async saveToServer() {
    if (!this.hasChanges()) return // Skip if no actual changes

    try {
      // Send JSON data to API endpoint (not direct to Wasabi!)
      await fetch('/api/annotations/auto-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: this.videoId,
          tenantId: this.tenantId,
          annotationType: 'layout', // or 'captions'
          annotations: this.currentState.annotations,
          expectedVersion: this.currentVersion
        })
      })

      this.lastSavedHash = this.computeHash(this.currentState)
      this.isDirty = false
    } catch (error) {
      // Log but don't bother user
      console.error('[Auto-Save] Server save failed:', error)
      this.reportToAdmin('server_save_failed', error)
    }
  }

  // Report issues to admin monitoring system
  private async reportToAdmin(issueType: string, error: any) {
    // Save current state snapshot to Wasabi (not Supabase!)
    const snapshotKey = await this.saveSnapshotToWasabi()

    // Log metadata to admin system (Sentry, CloudWatch, or Supabase)
    logAdminIssue({
      type: issueType,
      videoId: this.videoId,
      userId: this.userId,
      error: error.message,
      timestamp: Date.now(),
      snapshotStorageKey: snapshotKey  // Pointer to Wasabi, not the data itself
    })
  }

  private async saveSnapshotToWasabi(): Promise<string> {
    // Create database file from current state
    const dbPath = await this.createDatabaseFile(this.currentState)

    // Upload snapshot to Wasabi with timestamp
    const timestamp = Date.now()
    const snapshotKey = `${tenantId}/${videoId}/snapshots/error_${timestamp}_${userId}.db`

    await this.wasabiClient.upload_file(dbPath, snapshotKey)

    return snapshotKey
  }
}
```

---

## API Endpoint for Auto-Save

Browser sends annotation data to API, which queues Prefect flow.

```typescript
// apps/captionacc-web/app/routes/api.annotations.auto-save.tsx
import { json, type ActionFunctionArgs } from '@remix-run/node'
import { queueAutoSaveAnnotations } from '~/services/prefect'

export async function action({ request }: ActionFunctionArgs) {
  const {
    videoId,
    tenantId,
    annotationType,
    annotations,
    expectedVersion
  } = await request.json()

  // Queue Prefect flow (async, don't wait)
  // Flow will create SQLite DB and upload to Wasabi
  const result = await queueAutoSaveAnnotations({
    videoId,
    tenantId,
    annotationType, // 'layout' or 'captions'
    annotationsData: annotations,
    expectedVersion,
    userId: request.headers.get('X-User-ID') // From auth middleware
  })

  return json({
    status: 'queued',
    flowRunId: result.flowRunId,
    newVersion: result.newVersion // If version check passed
  })
}
```

## Prefect Flow for Auto-Save

Flow receives JSON data, creates database, uploads to Wasabi.

```python
# services/orchestrator/flows/auto_save_annotations.py
from prefect import flow, task
from pathlib import Path
import json
import tempfile

@task(name="create-db-from-json")
def create_database_from_json(
    annotations_data: dict,
    annotation_type: str,
) -> str:
    """
    Create SQLite database from browser JSON data.

    Args:
        annotations_data: Raw annotation data from browser
        annotation_type: 'layout' or 'captions'

    Returns:
        Path to created database file
    """
    # Create temporary database
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        db_path = f.name

    # Use existing pipeline code to create database
    if annotation_type == 'layout':
        from data_pipelines.layout_annotations import create_layout_db
        create_layout_db(annotations_data, db_path)
    elif annotation_type == 'captions':
        from data_pipelines.caption_annotations import create_captions_db
        create_captions_db(annotations_data, db_path)

    return db_path

@flow(name="auto-save-annotations")
def auto_save_annotations_flow(
    video_id: str,
    tenant_id: str,
    annotation_type: str,
    annotations_data: dict,
    expected_version: int,
    user_id: str,
) -> dict[str, Any]:
    """
    Auto-save annotations from browser to Wasabi.

    This flow is queued by the browser every 30 seconds (debounced).
    Silent - no user notification on success or failure.
    """
    print(f"[Auto-Save] {annotation_type} for video {video_id}")

    try:
        # Check version (optimistic locking)
        video_repo = VideoRepository()
        current_version = video_repo.get_annotation_version(video_id, annotation_type)

        if current_version != expected_version:
            # Conflict detected - use last-write-wins
            print(f"[Auto-Save] Conflict: expected v{expected_version}, got v{current_version}")

            # Save conflict snapshot before overwriting
            conflict_snapshot = save_conflict_snapshot(
                video_id, tenant_id, annotation_type, annotations_data, user_id
            )

            # Log for admin review
            log_conflict(
                video_id=video_id,
                annotation_type=annotation_type,
                expected_version=expected_version,
                actual_version=current_version,
                snapshot_key=conflict_snapshot
            )

        # Create database file from JSON
        db_path = create_database_from_json(annotations_data, annotation_type)

        # Upload to Wasabi
        storage_key = upload_annotation_db(
            tenant_id=tenant_id,
            video_id=video_id,
            annotation_type=annotation_type,
            db_path=db_path
        )

        # Increment version atomically
        new_version = video_repo.increment_annotation_version(
            video_id=video_id,
            annotation_type=annotation_type,
            updated_by=user_id
        )

        print(f"[Auto-Save] ✅ Saved {annotation_type} v{new_version}")

        return {
            "status": "success",
            "newVersion": new_version,
            "storageKey": storage_key
        }

    except Exception as e:
        print(f"[Auto-Save] ❌ Failed: {e}")

        # Log error for admin review (don't notify user)
        log_admin_issue({
            "type": "auto_save_failed",
            "video_id": video_id,
            "annotation_type": annotation_type,
            "error": str(e),
            "user_id": user_id
        })

        # Don't raise - let it fail silently
        return {
            "status": "failed",
            "error": str(e)
        }

@task(name="upload-annotation-db")
def upload_annotation_db(
    tenant_id: str,
    video_id: str,
    annotation_type: str,
    db_path: str,
) -> str:
    """Upload annotation database to Wasabi."""
    client = get_wasabi_client()

    # Storage key based on type
    db_filename = f"{annotation_type}.db"  # e.g., "layout.db" or "captions.db"
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, db_filename)

    client.upload_file(
        local_path=db_path,
        storage_key=storage_key,
        content_type="application/x-sqlite3"
    )

    return storage_key
```

## TypeScript Queue Function

```typescript
// apps/captionacc-web/app/services/prefect.ts
interface QueueAutoSaveOptions {
  videoId: string
  tenantId: string
  annotationType: 'layout' | 'captions'
  annotationsData: any
  expectedVersion: number
  userId: string
}

export async function queueAutoSaveAnnotations(
  options: QueueAutoSaveOptions
): Promise<QueueFlowResult> {
  log(`[Prefect] Auto-saving ${options.annotationType} for ${options.videoId}`)

  const result = await queueFlow('auto-save-annotations', {
    videoId: options.videoId,
    tenantId: options.tenantId,
    annotationType: options.annotationType,
    annotationsData: options.annotationsData,
    expectedVersion: options.expectedVersion,
    userId: options.userId
  })

  // Note: No user notification - silent save
  return result
}
```

## Optimistic Locking (Silent Conflict Detection)

Use version tokens to detect when another user/device has modified the data. When conflict detected, use **last-write-wins** but log for admin review.

### Database Schema

```sql
-- Add version tracking to detect concurrent edits
ALTER TABLE videos
ADD COLUMN layout_db_version INTEGER DEFAULT 1,
ADD COLUMN layout_db_updated_at TIMESTAMPTZ,
ADD COLUMN layout_db_updated_by UUID REFERENCES auth.users(id);

ALTER TABLE videos
ADD COLUMN captions_db_version INTEGER DEFAULT 1,
ADD COLUMN captions_db_updated_at TIMESTAMPTZ,
ADD COLUMN captions_db_updated_by UUID REFERENCES auth.users(id);
```

### Optimistic Lock Flow

```typescript
class OptimisticSave {
  private currentVersion: number = 1

  async saveToServer() {
    const dbPath = await this.createDatabaseFile(this.currentState)

    try {
      // Attempt save with version check
      const result = await this.uploadWithVersionCheck({
        videoId: this.videoId,
        dbPath,
        expectedVersion: this.currentVersion,
        userId: this.userId
      })

      if (result.success) {
        // Save succeeded
        this.currentVersion = result.newVersion
      } else if (result.conflict) {
        // Someone else saved since we loaded
        // Last-write-wins: overwrite anyway, but log conflict
        console.warn('[Auto-Save] Conflict detected, using last-write-wins')

        // Save conflict snapshots to Wasabi for admin review
        const conflictSnapshot = await this.saveConflictSnapshot()

        this.reportToAdmin('conflict_detected', {
          expectedVersion: this.currentVersion,
          actualVersion: result.actualVersion,
          overwrittenBy: result.previousUser,
          snapshotStorageKey: conflictSnapshot  // Pointer to Wasabi
        })

        // Force save with new version
        const forceResult = await this.forceUpload(dbPath)
        this.currentVersion = forceResult.newVersion
      }
    } catch (error) {
      console.error('[Auto-Save] Save failed:', error)
      this.reportToAdmin('save_failed', error)
      // Don't throw - let user continue working
    }
  }
}
```

### Server-Side Version Check

```python
@task(name="upload-layout-db-with-version-check")
def upload_layout_db_with_version_check(
    video_id: str,
    local_path: str,
    expected_version: int,
    user_id: str,
    tenant_id: str,
) -> dict[str, Any]:
    """
    Upload layout.db with optimistic locking.

    Returns conflict=True if version mismatch detected.
    """
    video_repo = VideoRepository()

    # Get current version from database
    current_version = video_repo.get_layout_db_version(video_id)

    if current_version != expected_version:
        # Conflict detected
        return {
            "success": False,
            "conflict": True,
            "expectedVersion": expected_version,
            "actualVersion": current_version,
            "previousUser": video_repo.get_layout_db_updated_by(video_id)
        }

    # No conflict - proceed with upload
    client = get_wasabi_client()
    storage_key = WasabiClient.build_storage_key(tenant_id, video_id, "layout.db")

    client.upload_file(
        local_path=local_path,
        storage_key=storage_key,
        content_type="application/x-sqlite3"
    )

    # Increment version atomically
    new_version = video_repo.increment_layout_db_version(
        video_id=video_id,
        updated_by=user_id
    )

    return {
        "success": True,
        "conflict": False,
        "newVersion": new_version
    }
```

```python
# VideoRepository methods
class VideoRepository:
    def increment_layout_db_version(self, video_id: str, updated_by: str) -> int:
        """Atomically increment version and return new version number."""
        result = self.supabase.rpc(
            'increment_layout_db_version',
            {
                'p_video_id': video_id,
                'p_updated_by': updated_by
            }
        ).execute()

        return result.data['new_version']
```

```sql
-- Atomic version increment function
CREATE OR REPLACE FUNCTION increment_layout_db_version(
    p_video_id UUID,
    p_updated_by UUID
) RETURNS TABLE(new_version INTEGER) AS $$
BEGIN
    UPDATE videos
    SET
        layout_db_version = layout_db_version + 1,
        layout_db_updated_at = NOW(),
        layout_db_updated_by = p_updated_by
    WHERE id = p_video_id
    RETURNING layout_db_version AS new_version;
END;
$$ LANGUAGE plpgsql;
```

---

## Loading State on Page Load

Browser downloads directly from Wasabi using signed URLs (authorized content only).

```typescript
async function loadAnnotationState(videoId: string) {
  // 1. Try IndexedDB first (fastest, most recent)
  const localState = await loadFromIndexedDB(videoId)

  // 2. Download from Wasabi (in parallel) - browser can download directly!
  const serverStatePromise = downloadFromWasabi(videoId)

  if (localState) {
    // Show local state immediately (optimistic)
    this.setState(localState)

    // Check server version in background
    const serverState = await serverStatePromise

    if (serverState.version > localState.version) {
      // Server is newer - silently replace local state
      console.log('[Auto-Save] Server state is newer, updating local')
      this.setState(serverState)
      await this.saveToIndexedDB(serverState) // Update local cache
    } else if (serverState.version < localState.version) {
      // Local is newer - push to server in background
      console.log('[Auto-Save] Local state is newer, syncing to server')
      await this.saveToServer() // Via API endpoint (browser can't upload)
    }
    // If versions match, no action needed
  } else {
    // No local state - use server state
    const serverState = await serverStatePromise
    this.setState(serverState)
    await this.saveToIndexedDB(serverState) // Cache locally
  }
}

async function downloadFromWasabi(videoId: string): Promise<AnnotationState> {
  // Get signed URL from API (authorizes download)
  const { signedUrl, version } = await fetch(`/api/annotations/download-url?videoId=${videoId}`)
    .then(r => r.json())

  // Download database directly from Wasabi using signed URL
  const dbBlob = await fetch(signedUrl).then(r => r.blob())

  // Parse database → extract annotations
  const annotations = await parseDatabaseBlob(dbBlob)

  return {
    videoId,
    annotations,
    version
  }
}
```

**API endpoint to generate signed URL:**

Note: Uses existing `generate_presigned_url` method from `WasabiClient` (same pattern as cropped frames chunks).

```typescript
// apps/captionacc-web/app/routes/api.annotations.download-url.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const videoId = url.searchParams.get('videoId')
  const annotationType = url.searchParams.get('type') ?? 'layout'

  // Check user permissions (RLS via Supabase)
  const hasAccess = await checkUserAccess(request, videoId)
  if (!hasAccess) throw new Response('Forbidden', { status: 403 })

  // Generate signed URL using existing WasabiClient method
  // (Same pattern as used for cropped frames chunks)
  const wasabiClient = get_wasabi_client()
  const storageKey = WasabiClient.build_storage_key(
    tenantId,
    videoId,
    `${annotationType}.db`  // e.g., "layout.db" or "captions.db"
  )

  const signedUrl = wasabiClient.generate_presigned_url(
    storage_key=storageKey,
    expiration=900  // 15 minutes (standard duration)
  )

  // Get current version from Supabase metadata
  const version = await getAnnotationVersion(videoId, annotationType)

  return json({ signedUrl, version })
}
```

---

## Save on Page Close

```typescript
class AnnotationState {
  setupPageCloseHandler() {
    window.addEventListener('beforeunload', (e) => {
      if (this.hasChanges()) {
        // Synchronous save to IndexedDB (guaranteed to complete)
        this.saveToIndexedDBSync()

        // Attempt background server save (best effort)
        // Note: This may not complete if page closes quickly
        this.saveToServerSync()

        // Don't warn user - just save silently
        // If save fails, we rely on next page load to sync
      }
    })

    // Beacon API for guaranteed background save on unload
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.hasChanges()) {
        // Use Beacon API for guaranteed delivery
        this.sendSaveBeacon()
      }
    })
  }

  private sendSaveBeacon() {
    // Beacon API sends data even if page is closing
    const blob = new Blob([JSON.stringify(this.currentState)], {
      type: 'application/json'
    })

    navigator.sendBeacon('/api/annotations/save-beacon', blob)
  }
}
```

```typescript
// Server endpoint to handle beacon saves
// apps/captionacc-web/app/routes/api.annotations.save-beacon.tsx
export async function action({ request }: ActionFunctionArgs) {
  const { videoId, tenantId, annotationType, annotations, expectedVersion } = await request.json()

  // Queue Prefect flow (same as regular auto-save)
  // Flow creates DB and uploads to Wasabi
  await queueAutoSaveAnnotations({
    videoId,
    tenantId,
    annotationType,
    annotationsData: annotations,
    expectedVersion,
    userId: request.headers.get('X-User-ID')
  })

  return json({ status: 'queued' })
}
```

---

## Admin Debugging Tools

When issues occur, provide admin-only tools to investigate and resolve.

### Admin Dashboard: Conflict Log

```typescript
// Admin-only route: /admin/annotation-conflicts
export async function loader() {
  const conflicts = await db.admin_conflict_logs
    .where('resolved', '=', false)
    .orderBy('timestamp', 'desc')
    .limit(100)

  return json({ conflicts })
}

// Display table of conflicts
function ConflictLog({ conflicts }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Video</th>
          <th>Type</th>
          <th>Time</th>
          <th>Users Involved</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {conflicts.map(conflict => (
          <tr key={conflict.id}>
            <td>{conflict.videoId}</td>
            <td>{conflict.conflictType}</td>
            <td>{formatTime(conflict.timestamp)}</td>
            <td>
              {conflict.user1} vs {conflict.user2}
            </td>
            <td>
              <button onClick={() => viewConflictDetails(conflict)}>
                View Details
              </button>
              <button onClick={() => markResolved(conflict.id)}>
                Mark Resolved
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

### Conflict Details View

```typescript
function ConflictDetails({ conflict }) {
  return (
    <div>
      <h2>Conflict Details</h2>

      <div>
        <h3>Version {conflict.version1} (Overwritten)</h3>
        <p>User: {conflict.user1}</p>
        <p>Timestamp: {formatTime(conflict.timestamp1)}</p>
        <button onClick={() => downloadSnapshot(conflict.snapshot1)}>
          Download Snapshot
        </button>
      </div>

      <div>
        <h3>Version {conflict.version2} (Winner)</h3>
        <p>User: {conflict.user2}</p>
        <p>Timestamp: {formatTime(conflict.timestamp2)}</p>
        <button onClick={() => downloadSnapshot(conflict.snapshot2)}>
          Download Snapshot
        </button>
      </div>

      <div>
        <h3>Resolution Options</h3>
        <button onClick={() => restoreVersion(conflict.version1)}>
          Restore Overwritten Version
        </button>
        <button onClick={() => exportBothForManualMerge(conflict)}>
          Export Both for Manual Merge
        </button>
        <button onClick={() => markAsExpected(conflict.id)}>
          Mark as Expected (No Action)
        </button>
      </div>
    </div>
  )
}
```

---

## Database Schema for Admin Logging

```sql
-- Log conflicts and issues for admin investigation
CREATE TABLE admin_conflict_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  conflict_type TEXT NOT NULL, -- 'version_conflict', 'save_failed', 'corruption_detected'

  -- Conflict participants
  user1_id UUID REFERENCES auth.users(id),
  user2_id UUID REFERENCES auth.users(id),

  -- Version info
  version1 INTEGER,
  version2 INTEGER,
  timestamp1 TIMESTAMPTZ,
  timestamp2 TIMESTAMPTZ,

  -- State snapshots (for recovery)
  snapshot1_storage_key TEXT, -- Wasabi key to saved snapshot
  snapshot2_storage_key TEXT,

  -- Metadata
  error_message TEXT,
  stack_trace TEXT,
  device_info JSONB,

  -- Resolution tracking
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conflicts_unresolved ON admin_conflict_logs(resolved) WHERE resolved = FALSE;
CREATE INDEX idx_conflicts_video ON admin_conflict_logs(video_id);
```

---

## Implementation Checklist

### Phase 1: Change Detection & Silent Save
- [ ] Implement content hashing for change detection
- [ ] Add isDirty flag tracking
- [ ] Debounced IndexedDB save (5s)
- [ ] Debounced server save (30s)
- [ ] Skip saves when no changes detected
- [ ] Remove all "draft saved" UI notifications

### Phase 2: Optimistic Locking
- [ ] Add version columns to videos table
- [ ] Implement version check on save
- [ ] Last-write-wins conflict resolution
- [ ] Log conflicts to admin_conflict_logs table
- [ ] Report errors to logging service (Sentry/CloudWatch)

### Phase 3: Page Close Handling
- [ ] beforeunload handler for synchronous IndexedDB save
- [ ] visibilitychange handler with Beacon API
- [ ] Server endpoint to handle beacon saves
- [ ] Remove "unsaved changes" warnings

### Phase 4: Admin Tools
- [ ] Admin conflict log dashboard
- [ ] Conflict details view
- [ ] Download conflict snapshots
- [ ] Restore previous version capability
- [ ] Mark conflicts as resolved

---

## Monitoring Metrics

Track these metrics to ensure auto-save is working silently:

- **Save success rate**: % of saves that complete successfully
- **Save latency**: p50, p95, p99 times for saves
- **Conflict frequency**: Number of version conflicts per day
- **Data loss incidents**: User-reported issues with lost work
- **No-op save rate**: % of saves skipped due to no changes (should be high)

---

## Expected Behavior

### Normal Case (99% of the time - B2C)
- User makes annotations on laptop
- Changes auto-save silently every 30 seconds
- User closes laptop
- Changes persisted via beforeunload + Beacon API
- User opens tablet, continues work
- Latest changes from laptop immediately available
- **No UI shown to user at any point**

### Conflict Case (rare - B2C single user, multiple devices)
- User edits on laptop while offline
- User edits same video on phone while offline
- Both devices come online and auto-save
- Phone saves last (last-write-wins)
- Laptop changes overwritten
- **User sees nothing** (assumes phone version is correct)
- **Admin gets notification** in conflict log
- Admin can restore laptop version if user reports lost work

**Future B2B:** Same flow, but conflicts between User A and User B instead of same user on different devices. Could add real-time presence indicators and notifications.

### Save Failure Case (very rare)
- Network failure during save
- Retry 3 times with exponential backoff
- If still fails, log to admin dashboard
- **User sees nothing** (work continues locally)
- Next successful save will sync everything
- IndexedDB ensures local work is never lost

---

## Code Locations

### New Files:
- `app/services/annotation-state.ts` - Main auto-save service
- `app/services/change-detection.ts` - Hash-based change detection
- `app/routes/api.annotations.save-beacon.tsx` - Beacon API endpoint
- `app/routes/admin.conflicts.tsx` - Admin conflict dashboard

### Modifications:
- `services/orchestrator/queue_flow.py` - Add version check to upload commands
- `services/orchestrator/supabase_client.py` - Add version increment methods
- `supabase/migrations/` - Add version columns and conflict log table
- `app/routes/api.annotations.$videoId.tsx` - Remove explicit save buttons

### Deletions:
- Remove all "Save Draft" buttons
- Remove all "Draft saved" notifications
- Remove all conflict resolution dialogs
