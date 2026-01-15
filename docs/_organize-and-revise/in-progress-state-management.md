# In-Progress Work State Management

## Problem Statement

Users may abandon annotation work without explicitly clicking "Save" or "Update". We need to preserve in-progress work automatically to prevent data loss and provide a seamless experience.

## Architecture Tiers

### Tier 1: Browser Auto-Save (Immediate)
**Storage:** IndexedDB (browser-local)
**Frequency:** Every change (debounced to 2-5 seconds)
**Scope:** Single device, single browser

```typescript
// Browser-side auto-save service
class AnnotationAutoSave {
  private dbName = 'caption-acc-drafts'
  private changeBuffer: Map<string, any> = new Map()
  private saveTimeout: NodeJS.Timeout | null = null

  // Debounced save - batches changes every 3 seconds
  scheduleAutoSave(videoId: string, changes: any) {
    this.changeBuffer.set(videoId, {
      ...this.changeBuffer.get(videoId),
      ...changes,
      lastModified: Date.now()
    })

    if (this.saveTimeout) clearTimeout(this.saveTimeout)

    this.saveTimeout = setTimeout(() => {
      this.flushToIndexedDB()
    }, 3000)
  }

  private async flushToIndexedDB() {
    const db = await this.openDB()
    const tx = db.transaction(['drafts'], 'readwrite')
    const store = tx.objectStore('drafts')

    for (const [videoId, draft] of this.changeBuffer.entries()) {
      await store.put({
        videoId,
        userId: getCurrentUserId(),
        draft,
        savedAt: new Date().toISOString(),
        deviceId: getDeviceFingerprint()
      })
    }

    this.changeBuffer.clear()
  }

  // Save on tab close
  setupBeforeUnloadHandler() {
    window.addEventListener('beforeunload', (e) => {
      if (this.changeBuffer.size > 0) {
        // Synchronous save to IndexedDB
        this.flushToIndexedDBSync()

        // Optional: warn user about unsaved changes
        e.preventDefault()
        e.returnValue = 'You have unsaved annotations. Close anyway?'
      }
    })
  }
}
```

**Advantages:**
- Zero network latency
- Works offline
- Immediate feedback

**Limitations:**
- Lost if user clears browser data
- Not accessible from other devices
- No conflict resolution across devices

---

### Tier 2: Server Draft Storage (Background Sync)
**Storage:** Wasabi + Supabase
**Frequency:** Every 30-60 seconds (background)
**Scope:** Cross-device, user-specific

```typescript
// Background sync to server drafts
class DraftSyncService {
  private syncInterval = 45000 // 45 seconds

  async backgroundSync(videoId: string) {
    const localDraft = await this.getLocalDraft(videoId)

    if (!localDraft || !localDraft.hasUnsyncedChanges) return

    // Upload draft to server
    await this.uploadDraft(videoId, localDraft)

    // Mark as synced locally
    await this.markAsSynced(videoId)
  }

  private async uploadDraft(videoId: string, draft: any) {
    // Create draft database file from changes
    const draftDbPath = await this.createDraftDb(draft)

    // Queue upload to Wasabi (separate from published version)
    await queueUploadDraft({
      videoId,
      draftDbPath,
      draftType: 'layout', // or 'captions'
      userId: getCurrentUserId(),
      timestamp: Date.now()
    })
  }
}
```

**Storage Structure:**
```
Wasabi:
{tenant}/{video}/drafts/{user_id}/
  ├── layout_draft_{timestamp}.db
  ├── captions_draft_{timestamp}.db
  └── metadata.json

Supabase annotation_drafts table:
  id, video_id, user_id, draft_type (layout|captions),
  storage_key, created_at, last_modified_at, device_id
```

**Advantages:**
- Cross-device access
- Survives browser data clearing
- Can recover from crashes

**Limitations:**
- Network dependency
- Slight delay before sync

---

### Tier 3: Published Versions (Explicit User Action)
**Storage:** Wasabi (canonical version)
**Frequency:** User clicks "Approve", "Publish", or "Update"
**Scope:** All users, production data

This is the current `upload-layout-db` flow - only triggered explicitly.

---

## Database Schema

### Supabase: annotation_drafts Table

```sql
CREATE TABLE annotation_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  draft_type TEXT NOT NULL CHECK (draft_type IN ('layout', 'captions')),

  -- Wasabi storage location
  storage_key TEXT NOT NULL,

  -- Metadata
  device_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_modified_at TIMESTAMPTZ DEFAULT NOW(),

  -- Track published status
  is_published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,

  -- Conflict tracking
  based_on_version_hash TEXT,  -- SHA-256 of base published version

  UNIQUE(video_id, user_id, draft_type, device_id)
);

CREATE INDEX idx_drafts_user_video ON annotation_drafts(user_id, video_id);
CREATE INDEX idx_drafts_unpublished ON annotation_drafts(is_published) WHERE is_published = FALSE;
```

### Row-Level Security

```sql
-- Users can only access their own drafts
CREATE POLICY "Users access own drafts"
  ON annotation_drafts
  FOR ALL
  USING (
    user_id = auth.uid() AND
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );
```

---

## UI State Management

### On Annotation Page Load

```typescript
async function loadAnnotationState(videoId: string) {
  // 1. Check for browser-local draft (fastest)
  const localDraft = await loadFromIndexedDB(videoId)

  // 2. Check for server draft (cross-device)
  const serverDraft = await fetchServerDraft(videoId)

  // 3. Download published version (if no drafts exist)
  const publishedVersion = await downloadPublishedVersion(videoId)

  // Conflict resolution
  if (localDraft && serverDraft) {
    const mostRecent = localDraft.savedAt > serverDraft.last_modified_at
      ? localDraft
      : serverDraft

    // Warn user if there's a conflict
    if (Math.abs(localDraft.savedAt - serverDraft.last_modified_at) > 60000) {
      showConflictDialog({
        local: localDraft,
        server: serverDraft,
        onResolve: (chosen) => loadDraft(chosen)
      })
    } else {
      loadDraft(mostRecent)
    }
  } else if (localDraft) {
    loadDraft(localDraft)
    // Background sync to server
    backgroundSync(videoId, localDraft)
  } else if (serverDraft) {
    loadDraft(serverDraft)
    // Save to IndexedDB for faster future loads
    saveToIndexedDB(videoId, serverDraft)
  } else {
    loadDraft(publishedVersion)
  }
}
```

### Auto-Save Flow

```typescript
// Component that triggers auto-save
function useAnnotationAutoSave(videoId: string) {
  const autoSave = useAutoSaveService()

  // Save on every annotation change (debounced)
  const handleAnnotationChange = useCallback((change) => {
    // Tier 1: Immediate IndexedDB save (debounced 3s)
    autoSave.scheduleLocalSave(videoId, change)

    // Tier 2: Background server sync (debounced 45s)
    autoSave.scheduleServerSync(videoId, change)
  }, [videoId])

  // Periodic full save (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      autoSave.forceServerSync(videoId)
    }, 300000)

    return () => clearInterval(interval)
  }, [videoId])

  return { handleAnnotationChange }
}
```

---

## Prefect Flows

### New Flow: upload-draft

```python
@flow(name="upload-draft")
def upload_draft_flow(
    video_id: str,
    draft_db_path: str,
    draft_type: str,  # 'layout' or 'captions'
    user_id: str,
    tenant_id: str = DEFAULT_TENANT_ID,
    device_id: str | None = None,
) -> dict[str, Any]:
    """
    Upload in-progress annotation draft to Wasabi.

    Separate from published versions to avoid overwriting canonical data.
    """
    # Compute hash of base published version (for conflict detection)
    published_db_path = download_published_version(tenant_id, video_id, draft_type)
    base_version_hash = compute_sha256(published_db_path) if published_db_path else None

    # Upload draft to user-specific location
    storage_key = WasabiClient.build_draft_storage_key(
        tenant_id=tenant_id,
        video_id=video_id,
        user_id=user_id,
        draft_type=draft_type,
        device_id=device_id
    )

    client = get_wasabi_client()
    client.upload_file(
        local_path=draft_db_path,
        storage_key=storage_key,
        content_type="application/x-sqlite3"
    )

    # Upsert draft metadata in Supabase
    drafts_repo = AnnotationDraftsRepository()
    drafts_repo.upsert_draft(
        video_id=video_id,
        user_id=user_id,
        draft_type=draft_type,
        storage_key=storage_key,
        device_id=device_id,
        based_on_version_hash=base_version_hash
    )

    return {
        "video_id": video_id,
        "draft_type": draft_type,
        "storage_key": storage_key,
        "status": "draft_saved"
    }
```

### Modified Flow: upload-layout-db (Publish Draft)

```python
@flow(name="upload-layout-db")
def upload_layout_db_flow(
    video_id: str,
    layout_db_path: str,
    user_id: str,
    tenant_id: str = DEFAULT_TENANT_ID,
    trigger_crop_regen: bool = True,
) -> dict[str, Any]:
    """
    Publish layout.db annotations (user explicitly approved).

    This marks the draft as published and promotes it to canonical version.
    """
    # Upload to canonical location
    storage_key = upload_layout_db_to_wasabi(tenant_id, video_id, layout_db_path)

    # Mark draft as published
    drafts_repo = AnnotationDraftsRepository()
    drafts_repo.mark_as_published(
        video_id=video_id,
        user_id=user_id,
        draft_type='layout'
    )

    # Detect crop region changes and trigger regeneration
    crop_region_changed, new_crop_region = detect_crop_region_change(video_id, layout_db_path)

    if crop_region_changed and trigger_crop_regen:
        # Queue crop frames regeneration
        from .crop_frames_to_webm import crop_frames_to_webm_flow
        crop_frames_to_webm_flow.apply_async(
            kwargs={"video_id": video_id, "tenant_id": tenant_id}
        )

    return {
        "video_id": video_id,
        "storage_key": storage_key,
        "status": "published",
        "crop_region_changed": crop_region_changed
    }
```

---

## Conflict Resolution Strategies

### Strategy 1: Last-Write-Wins (Simplest)
- Most recent timestamp wins
- Simple to implement
- Risk of losing work if user has stale draft

### Strategy 2: User Choice (Recommended)
- Detect conflicts based on base version hash
- Show user both versions
- Let user choose or merge manually

```typescript
function showConflictDialog({ local, server, onResolve }) {
  return (
    <Dialog>
      <h2>Your work was modified on another device</h2>

      <div className="conflict-options">
        <div className="option">
          <h3>This Device (Local)</h3>
          <p>Last saved: {formatTime(local.savedAt)}</p>
          <p>{local.annotationCount} annotations</p>
          <button onClick={() => onResolve(local)}>Use This Version</button>
        </div>

        <div className="option">
          <h3>Other Device (Server)</h3>
          <p>Last saved: {formatTime(server.last_modified_at)}</p>
          <p>{server.annotationCount} annotations</p>
          <button onClick={() => onResolve(server)}>Use Server Version</button>
        </div>
      </div>

      <button onClick={() => exportBothForManualMerge()}>
        Download Both for Manual Merge
      </button>
    </Dialog>
  )
}
```

### Strategy 3: Operational Transform (Complex)
- Merge changes automatically using OT or CRDT
- Most sophisticated, best UX
- Requires significant engineering effort

---

## Best Practice Recommendations

### For Your System:

1. **Implement Tier 1 (Browser Auto-Save) First**
   - Fastest to implement
   - Solves 80% of data loss scenarios
   - Low complexity

2. **Add Tier 2 (Server Drafts) for Production**
   - Essential for cross-device workflows
   - Enables recovery from crashes
   - Required for collaborative features later

3. **Keep Tier 3 (Published Versions) Explicit**
   - Users need clear "Publish" action
   - Prevents accidental overwrites of canonical data
   - Maintains audit trail

4. **Use User Choice Conflict Resolution**
   - Simple to implement
   - Transparent to users
   - Prevents silent data loss

5. **Add Visual Indicators**
   - "Draft saved 30 seconds ago" timestamp
   - "Syncing to server..." indicator
   - "Unsaved changes" warning on navigate

---

## Implementation Priority

### Phase 1: Browser Auto-Save (Week 1)
- [ ] IndexedDB service for local drafts
- [ ] Debounced save on annotation changes
- [ ] Save on beforeunload
- [ ] Load local draft on page load

### Phase 2: Server Draft Sync (Week 2)
- [ ] Supabase annotation_drafts table
- [ ] upload-draft Prefect flow
- [ ] Background sync service
- [ ] Download server draft on page load

### Phase 3: Conflict Resolution (Week 3)
- [ ] Detect conflicts based on timestamps
- [ ] Conflict resolution UI
- [ ] Base version hash tracking
- [ ] Manual merge export

### Phase 4: Polish (Week 4)
- [ ] Visual save indicators
- [ ] Draft management UI (list/delete old drafts)
- [ ] Auto-cleanup of old drafts
- [ ] Analytics on draft → publish conversion rate

---

## Code Locations

### New Files to Create:
- `apps/captionacc-web/app/services/annotation-auto-save.ts` - Browser auto-save service
- `apps/captionacc-web/app/services/draft-sync.ts` - Server draft sync
- `services/orchestrator/flows/draft_management.py` - Draft upload/download flows
- `services/orchestrator/supabase_client.py` - Add AnnotationDraftsRepository

### Modifications Needed:
- `apps/captionacc-web/app/routes/api.annotations.$videoId.tsx` - Add draft loading logic
- `services/orchestrator/queue_flow.py` - Add upload-draft command
- `apps/captionacc-web/app/services/prefect.ts` - Add queueUploadDraft()

---

## Monitoring

Track these metrics to ensure auto-save is working:

- **Draft save latency**: p50, p95, p99 times for browser saves
- **Draft sync success rate**: % of drafts successfully synced to server
- **Conflict frequency**: How often users encounter conflicts
- **Draft → publish conversion**: % of drafts that get published
- **Abandoned draft age**: Time distribution of unpublished drafts
