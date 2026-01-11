# API Route Audit

**Date:** 2026-01-10
**Context:** Migration from React Router SSR to SPA + FastAPI backend

## Summary

| Category | Routes | Target |
|----------|--------|--------|
| SQLite/Filesystem | 37 | FastAPI |
| Prefect Integration | 8 | FastAPI |
| TUS Upload | 1 | FastAPI |
| SSE/Realtime | 1 | FastAPI or Supabase Realtime |
| Admin | 7 | FastAPI |
| Direct Supabase | 3 | Client-side |
| **Total** | **54** | |

**Key Finding:** ~90% of routes access local SQLite databases or filesystem. They cannot become client-side calls and must migrate to a backend service.

---

## Category 1: Local SQLite + Filesystem (37 routes)

These read/write to local `captions.db` files per video and serve images from disk.

### Annotations (17 routes) -> Rename to Captions
| Route | Method | Operation |
|-------|--------|-----------|
| `api.annotations.$videoId` | GET | List annotations in frame range |
| `api.annotations.$videoId` | POST | Create annotation |
| `api.annotations.$videoId` | PUT | Update annotation with overlap resolution |
| `api.annotations.$videoId.$id.delete` | DELETE | Delete annotation |
| `api.annotations.$videoId.$id.text` | PUT | Update annotation text |
| `api.annotations.$videoId.bulk-annotate-all` | POST | Bulk annotate boxes across all frames |
| `api.annotations.$videoId.calculate-predictions` | POST | Train model and cache predictions |
| `api.annotations.$videoId.clear-all` | POST | Clear all annotations |
| `api.annotations.$videoId.frames.$frameIndex.boxes` | GET/POST | Get/save box annotations per frame |
| `api.annotations.$videoId.frames.$frameIndex.bulk-annotate` | POST | Bulk annotate boxes in rectangle |
| `api.annotations.$videoId.layout-analysis-boxes` | GET | Get layout analysis boxes |
| `api.annotations.$videoId.layout-complete` | POST | Mark layout as complete |
| `api.annotations.$videoId.layout-config` | PUT | Update crop/selection bounds |
| `api.annotations.$videoId.layout-queue` | GET | Get frames needing layout review |
| `api.annotations.$videoId.navigate` | GET | Navigate by update time |
| `api.annotations.$videoId.next` | GET | Get next annotation |
| `api.annotations.$videoId.process-regen-queue` | POST | Process image regeneration queue |
| `api.annotations.$videoId.processing-status` | GET | Get processing status |
| `api.annotations.$videoId.progress` | GET | Get workflow progress percentage |
| `api.annotations.$videoId.reset-crop-bounds` | POST | Reset crop bounds |
| `api.annotations.$videoId.review-labels` | GET | Get labels for review |
| `api.annotations.$videoId.text-queue` | GET | Get annotations needing text |
| `api.annotations.check-duplicates` | POST | Check for duplicate videos |

### Image Serving (4 routes)
| Route | Method | Operation |
|-------|--------|-----------|
| `api.full-frames.$videoId.$frameIndex[.jpg]` | GET | Serve JPEG blob from SQLite |
| `api.images.$videoId.full_frames.$filename` | GET | Serve full frame from filesystem |
| `api.images.$videoId.text_images.$filename` | GET | Serve text image from filesystem |
| `api.layout-visualization.$videoId.$frameIndex` | GET | Render layout visualization |

### Video Data (3 routes)
| Route | Method | Operation |
|-------|--------|-----------|
| `api.videos.$videoId.stats` | GET | Query annotation stats from SQLite |
| `api.videos.$videoId.metadata` | GET | Get video metadata |
| `api.preferences.$videoId` | GET/PUT | Read/write video preferences |

### Folders (6 routes)
| Route | Method | Operation |
|-------|--------|-----------|
| `api.folders` | GET | List folders from videos + metadata |
| `api.folders.create` | POST | Create empty folder |
| `api.folders.delete` | DELETE | Delete folder |
| `api.folders.file-count` | GET | Get file count per folder |
| `api.folders.move` | POST | Move folder |
| `api.folders.rename` | POST | Rename folder |

---

## Category 2: Prefect Integration (8 routes)

These queue jobs to Python Prefect workers or interact with Prefect API.

| Route | Method | Operation |
|-------|--------|-----------|
| `api.annotations.$videoId.recrop-frames` | POST | Queue crop_frames Prefect flow |
| `api.videos.$videoId.delete` | DELETE | Cancel Prefect flows + soft delete in Supabase |
| `api.videos.$videoId.retry` | POST | Retry failed video processing |
| `api.videos.$videoId.retry-crop-frames` | POST | Retry crop frames flow |
| `api.videos.$videoId.retry-full-frames` | POST | Retry full frames flow |
| `api.videos.move` | POST | Move video (updates Supabase) |
| `api.videos.rename` | POST | Rename video (updates Supabase) |
| `api.webhooks.prefect` | POST | Receive Prefect automation webhooks |

---

## Category 3: TUS Upload (1 route)

| Route | Method | Operation |
|-------|--------|-----------|
| `api.upload.$` | POST/HEAD/PATCH/OPTIONS | TUS resumable upload protocol |

**Complexity:** Handles chunked uploads, writes to filesystem, creates Supabase entry, queues Prefect flow.

---

## Category 4: SSE/Realtime (1 route)

| Route | Method | Operation |
|-------|--------|-----------|
| `api.events.video-stats` | GET | SSE stream for processing updates |

**Note:** Could migrate to Supabase Realtime instead.

---

## Category 5: Admin (7 routes)

| Route | Method | Operation |
|-------|--------|-----------|
| `api.admin.databases.$videoId.schema` | GET | Inspect SQLite schema |
| `api.admin.databases.list` | GET | List all databases with filters |
| `api.admin.databases.repair` | POST | Repair/migrate all databases |
| `api.admin.databases.status` | GET | Database health summary |
| `api.admin.failed-crop-frames` | GET | Scan for failed videos |
| `api.admin.model-version-check` | POST | Trigger batch model check |
| `api.admin.security` | GET | Query Supabase security audit logs |

---

## Category 6: Direct Supabase (3 routes)

These are thin wrappers that can become client-side Supabase calls.

| Route | Method | Migration |
|-------|--------|-----------|
| `api.videos.list` | GET | `supabase.from('videos').select(...)` |
| `api.auth.is-platform-admin` | GET | Client check via user metadata or RLS |
| `api.auth.feature-access` | GET | Client check via user profile |
| `api.auth.complete-signup` | POST | Supabase Edge Function or client-side |

---

## Current Dependencies

### Node.js Packages Used by API Routes
- `better-sqlite3` - SQLite database access
- `@supabase/supabase-js` - Supabase client
- `@tus/server` / `@tus/file-store` - TUS upload protocol
- `fs` / `path` - Filesystem operations
- `child_process` - Spawn Python for Prefect cancellation

### External Services
- **Supabase** - Auth, video metadata (Postgres), security audit logs
- **Prefect** - Video processing workflow orchestration
- **Wasabi S3** - Video/image storage (via Prefect flows)

---

## File Locations

- Routes: `apps/captionacc-web/app/routes/api.*.tsx`
- Services: `apps/captionacc-web/app/services/`
- SQLite DBs: `local/processing/{hash}/{videoId}/captions.db`
- Upload temp: `local/uploads/`
- Folder metadata: `local/data/.folders.json`
