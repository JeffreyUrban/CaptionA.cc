# Frontend-to-Backend Migration Plan: TypeScript to Python/Wasabi/Supabase

## Executive Summary

This plan outlines the migration from the current TypeScript backend to the new Python/Wasabi/Supabase-centric backend. The existing frontend pages and features remain the same - we're updating the data access layer only.

**Key Changes:**
- Replace REST annotation endpoints with CR-SQLite WebSocket sync
- Replace backend-mediated S3 access with client-side STS credentials
- Keep Supabase authentication (no changes)
- Keep all existing frontend UI/pages (only data access layer changes)
- Delete TypeScript backend API routes after data access layer updated

**Approach:** Update data access layer in existing frontend, deploy cleanly, delete old backend code
**Timeline:** 8-10 weeks optimizing for quality
**Scope:** Match existing functionality - no new features, identify backend gaps for later work
**Risk Level:** Low (no dual-backend complexity, clean cutover)

---

## Architecture Transformation

### Current Architecture (TypeScript Backend)
```
Browser → Remix API Routes (TypeScript) → better-sqlite3 (server-side) → Local filesystem/Wasabi
         ↓
      Supabase (auth + metadata)
```

**~60 REST API endpoints** in `/app/routes/api.*`:
- `/api/annotations/{videoId}` - Annotation CRUD
- `/api/annotations/{videoId}/{id}/text` - Caption text
- `/api/images/{videoId}/*` - Frame images (proxied)
- `/api/videos/{videoId}/metadata` - Video metadata
- `/api/upload` - TUS resumable uploads
- Many more for layout, processing, folders, etc.

### New Architecture (Python Backend)
```
Browser → wa-sqlite (client-side) ←WebSocket→ FastAPI (Python) → Wasabi S3
         ↓                                                             ↑
         → AWS SDK ────────────────────────────────────────────────────┘
         ↓
      Supabase (auth + metadata, same as before)
```

**8 REST endpoints + 2 Edge Functions:**
- `GET /videos/{videoId}/database/{db}/state` - Database version/lock status
- `POST /videos/{videoId}/database/{db}/lock` - Acquire lock
- `DELETE /videos/{videoId}/database/{db}/lock` - Release lock
- `WebSocket /videos/{videoId}/sync/{db}` - Real-time sync
- `GET/PUT /videos/{videoId}/preferences` - Preferences
- `GET /admin/databases` - Admin database list
- `POST /admin/databases/{videoId}/{db}/sync` - Force sync
- `POST /admin/locks/cleanup` - Release stale locks
- **Edge Functions:**
  - `GET /functions/v1/captionacc-s3-credentials` - STS credentials
  - `POST /functions/v1/captionacc-presigned-upload` - Upload URL

---

## Phase 1: Foundation Infrastructure (Weeks 1-2)

### Objective
Establish core infrastructure for new Python backend integration.

### 1.1 CR-SQLite Browser Integration

**New Files to Create:**

```
app/services/crsqlite-client.ts          - Core wa-sqlite + CR-SQLite manager
app/services/database-loader.ts          - Download & decompress from Wasabi
app/services/websocket-sync.ts           - WebSocket sync manager
app/services/database-lock.ts            - Lock acquisition/release
app/stores/database-store.ts             - Zustand store for database state
app/services/database-subscriptions.ts   - Change notification system
app/services/database-errors.ts          - Structured error handling
```

**Package Dependencies:**
```json
{
  "@vlcn.io/crsqlite-wasm": "^0.16.0",
  "wa-sqlite": "^0.9.9"
}
```

**Key Implementation Details:**
- wa-sqlite runs in browser with CR-SQLite WASM extension
- Download layout.db.gz and captions.db.gz from Wasabi using STS credentials
- Decompress using native DecompressionStream (Chrome 80+, Safari 16.4+, Firefox 105+)
- WebSocket protocol for bidirectional sync (client ↔ server)
- User-level locking (not session-level) for tab handoff support

### 1.2 Direct S3 Access Layer

**New Files to Create:**

```
app/services/s3-credentials.ts           - STS credential management
app/stores/s3-credentials-store.ts       - Zustand store for credentials
app/services/s3-client.ts                - S3 client wrapper with retry logic
app/services/frame-cache.ts              - LRU cache for frame images
app/components/S3Image.tsx               - S3-backed image component
app/components/S3Video.tsx               - S3-backed video component
```

**Key Implementation Details:**
- Fetch STS credentials from Supabase Edge Function
- Cache credentials in sessionStorage until expiration
- Multi-tab coordination via BroadcastChannel API
- Auto-refresh credentials 5 minutes before expiration
- Use AWS SDK v3 for S3 operations (already in package.json)

### 1.3 Configuration

**Update File:** `app/config.ts`

```typescript
export const API_CONFIG = {
  PYTHON_API_URL: import.meta.env.VITE_API_URL || 'https://api.captiona.cc/v1',
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
}
```

No feature flags needed - single implementation only.

### Testing Strategy (Phase 1)
- [ ] Unit tests for CR-SQLite client initialization
- [ ] Unit tests for STS credential refresh logic
- [ ] Integration test: Download test database from S3
- [ ] Integration test: CR-SQLite can apply changes
- [ ] Test multi-tab credential coordination

**Success Criteria:**
✅ wa-sqlite + CR-SQLite loads successfully in browser
✅ Can download and decompress .db.gz from Wasabi
✅ STS credentials refresh automatically
✅ Core services ready for integration

---

## Phase 2: Layout Annotation Implementation (Weeks 3-5)

### Objective
Implement the layout annotation workflow with CR-SQLite sync (first workflow).

### 2.1 Database Sync Service

**New Files:**

```
app/services/layout-sync-service.ts      - Layout database sync service
app/hooks/useLayoutDatabase.ts           - React hook for layout operations
app/services/database-queries.ts         - Type-safe query builders
```

**Files to Modify:**

```
app/hooks/useLayoutData.ts               - Replace layout-api.ts calls with useLayoutDatabase
app/routes/annotate.layout.tsx           - Add lock acquisition UI
```

**Files to Delete (after new implementation works):**

```
app/utils/layout-api.ts                  - Old REST API utilities (delete completely)
app/routes/api.annotations.*.layout*.tsx - Old layout endpoints (delete completely)
```

**Implementation Pattern:**

```typescript
// OLD: REST API call
await fetch(`/api/annotations/${videoId}/layout-analysis-boxes`)

// NEW: Local SQLite query
const db = await layoutSync.getDatabase(videoId)
const boxes = db.exec('SELECT * FROM layout_analysis_boxes WHERE frame_index = ?', [frameIndex])
```

### 2.2 Lock Management UI

**New Components:**

```
app/components/annotation/DatabaseLockBanner.tsx    - Lock status indicator
app/components/annotation/LockAcquisitionModal.tsx  - Lock request UI
```

**Lock States:**
- `checking` - Checking current lock state
- `acquiring` - Attempting to acquire lock
- `granted` - Lock acquired, can edit
- `denied` - Another user has lock (show who)
- `transferring` - Same user, different tab (show handoff UI)
- `server_processing` - Server has lock for ML (read-only)

### 2.3 Image Loading Migration

**Files to Modify:**

```
app/components/annotation/LayoutThumbnailGrid.tsx   - Use S3Image component
app/components/annotation/LayoutMainCanvas.tsx      - Use direct S3 URLs
```

**Pattern:**
```typescript
// OLD: API proxy
<img src={`/api/images/${videoId}/full_frames/${filename}`} />

// NEW: Direct S3 with signed URL
<S3Image videoId={videoId} path={`full_frames/${filename}`} alt="Frame" />
```

### Testing Strategy (Phase 2)
- [ ] Test box annotation updates (in/out/clear)
- [ ] Test WebSocket sync with server
- [ ] Test lock acquisition and release
- [ ] Test multi-tab handoff (same user)
- [ ] Test concurrent user locking
- [ ] Test image loading from S3
- [ ] Integration test full layout workflow end-to-end

**Success Criteria:**
✅ Layout workflow fully functional with CR-SQLite
✅ Lock prevents concurrent edits
✅ Tab handoff works seamlessly
✅ Image loading faster or equivalent to API
✅ No data loss during sync

---

## Phase 3: Caption Annotation Implementation (Weeks 6-8)

### Objective
Implement caption frame extents and text annotation workflows.

### 3.1 Caption Database Sync Service

**New Files:**

```
app/services/caption-sync-service.ts     - Caption database sync service
app/hooks/useCaptionsDatabase.ts         - React hook for caption operations
```

**Files to Modify:**

```
app/hooks/useTextAnnotationData.ts       - Replace fetch calls with useCaptionsDatabase
app/hooks/useCaptionFrameExtentsAnnotationData.ts  - Replace with local queries
```

**Implementation:**

```typescript
// Replace REST calls in useTextAnnotationData.ts
async function saveAnnotationText(videoId, annotationId, text, status, notes) {
  const db = await captionSync.getDatabase(videoId)
  db.exec(
    'UPDATE caption_frame_extents SET text = ?, text_status = ?, text_notes = ? WHERE id = ?',
    [text, status, notes, annotationId]
  )
  // CR-SQLite automatically syncs changes via WebSocket
}
```

### 3.2 Frame Loader Migration

**Files to Modify:**

```
app/hooks/useCaptionFrameExtentsFrameLoader.ts   - Replace API calls with direct S3
```

**Changes:**
- Replace `/api/frames/batch-signed-urls` endpoint with client-side URL generation using STS credentials
- Generate signed URLs client-side for WebM chunks
- Keep hierarchical loading strategy (modulo_16 → modulo_4 → modulo_1)
- Keep existing chunk caching logic (already uses S3 URLs)

### 3.3 Preferences Migration

**Files to Modify:**

```
app/hooks/useTextAnnotationPreferences.ts   - Query from captions.db instead of API
```

Preferences now live in captions.db, no separate endpoint needed.

### Testing Strategy (Phase 3)
- [ ] Test caption text editing
- [ ] Test caption frame extent updates
- [ ] Test offline editing (brief disconnections)
- [ ] Test sync conflict resolution
- [ ] Test frame loading with direct S3
- [ ] Test preferences persistence
- [ ] Integration test full caption workflow end-to-end

**Success Criteria:**
✅ Caption workflow fully functional with CR-SQLite
✅ Text editing works offline
✅ Sync handles conflicts correctly
✅ Frame loading performance acceptable
✅ Preferences sync properly

---

## Phase 4: Upload Implementation (Week 9)

### Objective
Implement presigned S3 upload URLs (replacing TUS).

### 4.1 New Upload Flow

**New Files:**

```
app/services/s3-upload.ts                - Direct S3 upload with progress
```

**Files to Modify:**

```
app/hooks/useUploadManager.ts            - Replace TUS with S3 presigned URLs
app/stores/upload-store.ts               - Update for new upload state
```

**Flow:**
1. Call Edge Function: `POST /functions/v1/captionacc-presigned-upload`
2. Receive presigned S3 URL + videoId
3. Upload directly to S3 with XMLHttpRequest (progress tracking)
4. On complete, server auto-detects and triggers Prefect workflow

### 4.2 Delete TUS Endpoint

**Files to Delete:**

```
app/routes/api.upload.$.tsx              - Delete completely after new upload works
```

### Testing Strategy (Phase 4)
- [ ] Test large file uploads (>1GB)
- [ ] Test upload resumption after network failure
- [ ] Test progress reporting accuracy
- [ ] Verify Prefect workflow triggers correctly
- [ ] Test concurrent uploads

**Success Criteria:**
✅ Upload completes successfully
✅ Progress tracking works
✅ Large files handled correctly
✅ Processing workflow triggers

---

## Phase 5: Metadata & Admin (Week 10)

### Objective
Implement remaining read-only and admin functionality.

### 5.1 Video Metadata

**Files to Modify:**

```
app/hooks/useVideoMetadata.ts            - Use Supabase client directly (already exists)
```

No API route needed - Supabase client queries `videos` table directly.

### 5.2 Real-Time Stats

**Files to Modify:**

```
app/hooks/useVideoStatsSSE.ts            - Replace SSE with Supabase realtime
app/hooks/useProcessingStatus.ts         - Use Supabase subscriptions
```

**Pattern:**
```typescript
const subscription = supabase
  .channel('video-stats')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'captionacc_production',
    table: 'videos',
    filter: `id=eq.${videoId}`
  }, payload => updateVideoStats(payload.new))
  .subscribe()
```

### 5.3 Admin Endpoints

**Files to Delete:**

```
app/routes/api.admin.*.tsx               - Delete after porting to Python API
```

Update admin UI to call new Python API endpoints directly.

### Testing Strategy (Phase 5)
- [ ] Test realtime video stats updates
- [ ] Test admin operations
- [ ] Verify permissions work correctly

**Success Criteria:**
✅ Metadata queries work
✅ Real-time updates functional
✅ Admin operations successful

---

## Phase 6: Final Cleanup & Deployment (Week 10)

### Objective
Remove all obsolete code and deploy new implementation.

### 6.1 Deprecated Endpoints to Remove

**Delete entire directories/files:**

```
app/routes/api.annotations.*.tsx         - All annotation endpoints
app/routes/api.images.*.tsx              - All image proxy endpoints
app/routes/api.videos.*.tsx              - Video management endpoints
app/routes/api.upload.$.tsx              - TUS upload endpoint
app/routes/api.folders.*.tsx             - Folder management
app/routes/api.preferences.*.tsx         - Preferences endpoint
app/routes/api.events.*.tsx              - SSE endpoint
app/utils/layout-api.ts                  - OLD API utilities
```

**Before Deletion Checklist:**
- [ ] Updated data access layer tested to match existing functionality
- [ ] Integration tests passing
- [ ] Document any backend gaps for future work
- [ ] Backup code to archive branch (for reference only)

### 6.2 Update Documentation

- [ ] Update README with new architecture
- [ ] Document CR-SQLite sync protocol
- [ ] Document S3 direct access patterns
- [ ] Update developer setup guide

### Testing Strategy (Phase 6)
- [ ] Full regression test suite
- [ ] Load test with concurrent users
- [ ] Chaos test (random disconnections)

**Success Criteria:**
✅ All workflows functional without TypeScript backend
✅ No references to deleted endpoints
✅ Documentation updated

---

## Risk Mitigation

### Key Risks to Address

1. **Database Sync Conflicts:** Test conflict scenarios thoroughly, ensure server is source of truth
2. **Lock Starvation:** Implement auto-timeout (15 min), show lock holder in UI
3. **S3 Access Performance:** Test from multiple regions before deploy
4. **Browser Compatibility:** Test with different browsers and database sizes

**See `docs/risk-mitigation-ideas.md` for detailed mitigation strategies**

### Deployment Approach

**Clean Cutover:**
- Test thoroughly (no rollback option)
- Deploy when all tests pass
- Document any backend gaps for future work
- Delete old backend code after validation

---

## Success Metrics

### Performance
- **Database sync latency:** p95 < 100ms
- **S3 image load time:** p95 < 500ms
- **Lock acquisition:** p95 < 200ms
- **WebSocket uptime:** > 99.5%

### Reliability
- **Zero data loss** during sync
- **Conflict resolution success:** > 99%
- **Rollback time:** < 5 minutes if needed
- **Error rate:** < 1%

### User Experience
- **No increase** in error reports
- **Improved offline capability** (works during brief disconnections)
- **Faster initial load** (cached databases)
- **Seamless tab switching** (same user)

---

## Dependencies & Prerequisites

### Infrastructure Required
- [ ] Wasabi bucket configured with STS policies
- [ ] Supabase Edge Functions deployed
- [ ] FastAPI backend deployed at api.captiona.cc
- [ ] WebSocket load balancer configured
- [ ] Wasabi CORS configured for app.captiona.cc

### Code Dependencies
- [ ] @vlcn.io/crsqlite-wasm package
- [ ] wa-sqlite package
- [ ] AWS SDK for S3 (already installed)

---

## Critical Files Reference

### Phase 1 (Foundation)
- **NEW:** `app/services/crsqlite-client.ts` - Core database manager
- **NEW:** `app/services/websocket-sync.ts` - WebSocket sync manager
- **NEW:** `app/services/s3-credentials.ts` - STS credential management
- **NEW:** `app/stores/database-store.ts` - Database state store
- **NEW:** `app/stores/s3-credentials-store.ts` - Credentials state store

### Phase 2 (Layout)
- **NEW:** `app/services/layout-sync-service.ts` - Layout sync service
- **NEW:** `app/hooks/useLayoutDatabase.ts` - Layout database hook
- **MODIFY:** `app/hooks/useLayoutData.ts` (533 lines) - Replace API calls
- **MODIFY:** `app/routes/annotate.layout.tsx` (900+ lines) - Add lock UI
- **MODIFY:** `app/components/annotation/LayoutThumbnailGrid.tsx` - S3 images

### Phase 3 (Captions)
- **NEW:** `app/services/caption-sync-service.ts` - Caption sync service
- **NEW:** `app/hooks/useCaptionsDatabase.ts` - Caption database hook
- **MODIFY:** `app/hooks/useTextAnnotationData.ts` (284 lines) - Replace fetch calls
- **MODIFY:** `app/hooks/useCaptionFrameExtentsFrameLoader.ts` (779 lines) - Direct S3

### Phase 4 (Upload)
- **NEW:** `app/services/s3-upload.ts` - Direct S3 upload
- **MODIFY:** `app/hooks/useUploadManager.ts` - Replace TUS

### Phase 5 (Metadata)
- **MODIFY:** `app/hooks/useVideoStatsSSE.ts` - Supabase realtime

### Phase 6 (Cleanup)
- **DELETE:** `app/routes/api.*` - All old API routes (~60 files)
- **DELETE:** `app/utils/layout-api.ts` - Old API utilities

---

## Timeline Summary

| Phase | Duration | Key Deliverable | Risk Level |
|-------|----------|----------------|------------|
| 1 | 2 weeks | CR-SQLite + S3 infrastructure | Low |
| 2 | 3 weeks | Layout annotation implemented | Medium |
| 3 | 3 weeks | Caption annotation implemented | Medium |
| 4 | 1 week | Upload flow implemented | Low |
| 5 | 1 week | Metadata/admin implemented | Low |
| 6 | 1 week | Cleanup & deployment | Low |
| **Total** | **10 weeks** | Complete implementation | - |

**Note:** Timeline optimized for quality with clean cutover approach. No backwards compatibility or gradual rollout complexity.

---

## Decisions Made

Based on user input:

1. **Timeline:** 10 weeks, optimized for quality
2. **Priority:** Layout annotation first
3. **Backwards Compatibility:** None needed - clean cutover
4. **Testing:** Thorough testing required (no rollback option)
5. **Deployment:** Clean cutover when ready (no gradual rollout)
6. **Data Migration:** Not needed - fresh start with new backend

---

## Verification Plan

### End-to-End Testing
- [ ] Complete layout annotation workflow
- [ ] Complete caption annotation workflow
- [ ] Upload new video and process
- [ ] Multi-user concurrent editing
- [ ] Multi-tab same user editing
- [ ] Offline → online sync recovery
- [ ] Database corruption recovery
- [ ] Lock timeout and release
- [ ] S3 credential expiration and refresh

### Performance Testing
- [ ] Load test: 50 concurrent users
- [ ] Stress test: Large database (10,000+ annotations)
- [ ] Network test: Slow connections (3G)
- [ ] Memory test: Long-running sessions (8+ hours)

### Security Testing
- [ ] Cross-tenant access prevention
- [ ] STS credential scope validation
- [ ] Lock bypass prevention
- [ ] SQL injection attempts (SQLite)

---

## Post-Migration Optimization

After successful migration, consider:

1. **IndexedDB Caching:** Cache downloaded databases for faster subsequent loads
2. **Service Worker:** Offline support for brief disconnections
3. **CloudFront CDN:** Reduce S3 latency for global users
4. **Delta Sync:** Only sync changed rows instead of full database
5. **Compression:** More aggressive database compression (SQLite VACUUM)

---

This plan provides a comprehensive, phased approach to migrating from the TypeScript backend to the new Python/Wasabi/Supabase architecture while minimizing risk and maintaining backward compatibility throughout the transition.
