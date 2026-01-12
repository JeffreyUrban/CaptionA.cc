# Architecture Decisions

**Date:** 2026-01-11
**Updated:** CR-SQLite sync model for client-facing databases
**Context:** Migration from React Router SSR to SPA + FastAPI backend

## Services

| Service | Function | Infra | Cost |
|---------|----------|-------|------|
| **api** | Sync: database locks, CR-SQLite WebSocket | Fly.io (auto-stop) | Pay for usage |
| **prefect** | Job orchestration | Fly.io (auto-stop) | Pay for usage |
| **modal-gpu** | Async: full_frames + OCR, crop + inference | Modal | Per-video, scales to 0 |

All services scale to zero when idle.

## Data Flow

```
1. UPLOAD
   Client ──presigned URL──▶ Wasabi

2. FULL FRAMES + OCR (async, Modal)
   modal-gpu: Wasabi (video) → full_frames → thumbnails → OCR → raw-ocr.db → Wasabi
                                                                → layout.db (boxes) → Wasabi

3. USER SESSION - LAYOUT (sync, Fly.io + CR-SQLite)
   Client ◄───STS credentials───▶ Wasabi (layout.db.gz, if needsDownload)
   Client ◄──── WebSocket ────▶ api (working copy on disk)
   api: box annotations ↔ ML predictions ↔ crop bounds
        Periodically uploads to Wasabi (idle/checkpoint)

4. CROP + INFERENCE (async, Modal, blocks user)
   modal-gpu: Wasabi (video) + bounds → crop_frames → inference → results → Wasabi
   api: process results → captions.db → sync to client

5. USER SESSION - CAPTIONS (sync, Fly.io + CR-SQLite)
   Client ◄───STS credentials───▶ Wasabi (captions.db.gz, if needsDownload)
   Client ◄──── WebSocket ────▶ api (working copy on disk)
   api: boundary edits, text edits
        Periodically uploads to Wasabi
```

## Key Decisions

### Authentication & Tenant Isolation
- **JWT flow**: SPA authenticates with Supabase → receives JWT (1hr default, auto-refresh)
- **JWT validation**: FastAPI validates signature (HS256) with Supabase secret, audience = "authenticated"
- **Required claims**: `sub` (user_id), `tenant_id` - missing either returns 401
- **Direct Supabase queries**: SPA queries video list, user profile directly (RLS enforced)

**Wasabi tenant isolation:**
- All S3 paths scoped: `{tenant_id}/client/videos/{video_id}/...` or `{tenant_id}/server/videos/{video_id}/...`
- `tenant_id` extracted from validated JWT, never from request params
- STS credentials (via Edge Function) scoped to tenant's `client/*` path only
- Client cannot access other tenants - IAM session policy enforced
- Upload URLs via Supabase Edge Functions (keeps Wasabi creds isolated from API)

### CR-SQLite Sync

Client-facing databases (`layout.db`, `captions.db`) sync via CR-SQLite:

| Database | Sync Direction | Purpose |
|----------|----------------|---------|
| `layout.db` | Bidirectional | Client: annotations. Server: predictions, bounds |
| `captions.db` | Client→Server | During caption workflow |

**Why CR-SQLite:**
- Instant local edits (no round-trip latency)
- Automatic conflict resolution (CRDT-based, LWW)
- Offline resilience for brief disconnections
- Efficient sync (only changed rows, not full database)

**Storage layers:**
```
Browser (wa-sqlite)     → instant edits
Server (local disk)     → durable working copy, fsync before ack
Wasabi S3 (.db.gz)      → cold storage, periodic upload, gzip compressed
```

**Lock model:**
- User-level locking (not session-level)
- Same user can switch tabs transparently (automatic handoff)
- `video_database_state` table in Supabase tracks locks and versions
- Lock types: `client` (user editing), `server` (ML processing)

**Wasabi upload triggers:**
- Idle timeout (no activity for ~5 min)
- Periodic checkpoint (~15 min, timer resets on any upload)
- Server shutdown (SIGTERM handler)
- Workflow exit (user leaves video)

**NOT triggers:** Individual syncs, WebSocket disconnect, session handoff.

See: [Sync Protocol Reference](../data-architecture/sync-protocol.md)

### API Style
- **Sync endpoints** for database state, locks, WebSocket connection
- **REST** for read-only data: stats, preferences
- **STS credentials** (Edge Function) for all client Wasabi access (media + databases)
- Everything scoped under `/videos/{videoId}`
- ~8 consolidated endpoints
- Client-facing only (no internal service endpoints)
- Server-side operations (layout analysis, crop+inference) triggered by state changes

### Realtime Updates
- **Database sync**: WebSocket for CR-SQLite changes
- **Job status**: Supabase Realtime for `videos` table changes (processing status)
- Jobs write status directly to Supabase (no internal API endpoints)

### Prefect Hosting
- Self-hosted on Fly.io (auto-stop)
- Prefect Cloud free tier too limited (5 deployments, have 10+ flows)
- Prefect Cloud paid tier too expensive ($100/mo for 20 deployments)
- Self-hosted: ~$3/mo, unlimited deployments

### Storage

**Wasabi S3:**
- **Videos**: Original uploads (direct access via STS credentials)
- **Full frames**: `full_frames/*.jpg` (direct access via STS credentials, ~500KB each)
- **Thumbnails**: Alongside full frames (~10KB each, ~100px wide)
- **Client databases**: `layout.db.gz`, `captions.db.gz` (direct access via STS credentials, gzip compressed)
- **Server databases**: `raw-ocr.db.gz`, `layout-server.db.gz` (gzip compressed, server-only)
- **Cropped frame chunks**: VP9 WebM files (direct access via STS credentials)
- **S3 versioning**: Enabled for corruption recovery

**Server local disk:**
- **Working copies**: `/var/data/captionacc/working/{tenant}/{video}/*.db`
- **SQLite WAL mode**: Crash safety, concurrent reads
- **Durability**: fsync/commit before sending ack to client

**Compression:**
- Client-facing databases gzip compressed for Wasabi storage
- Browser decompresses using native `DecompressionStream`
- Reduces upload/download time and storage cost

### Frame Images (Layout Page)
- **Thumbnails generated during OCR job**: Ready when user arrives at layout page
- **Direct S3 access via STS credentials**: Client gets tenant-scoped credentials once per session
- **Workflow**:
  1. Client gets STS credentials (Edge Function, scoped to `{tenant_id}/client/*`)
  2. Client acquires lock, downloads layout.db.gz if needed, connects WebSocket for sync
  3. Client reads box data from local layout.db
  4. Client fetches frames directly from Wasabi using S3 SDK (no API round-trip)

### Frame Chunks (Caption Editing)
- **VP9 WebM chunks**: 32 cropped frames per chunk, generated during crop+inference
- **Direct S3 access via STS credentials**: Same credentials used for frame images
- **Hierarchical loading**: modulo levels (16, 4, 1) for coarse-to-fine progressive loading
- **Client-side extraction**: Fetch WebM, load in video element, seek + canvas extract
- **LRU cache with pinning**: ~75-130MB across modulo levels, pins active/next annotation
- **Non-duplicating**: Each frame belongs to exactly one modulo level

### Video Processing (Modal)
- All heavy compute on Modal: full_frames, thumbnails, OCR, crop_frames, inference
- GPU FFmpeg for frame extraction
- Thumbnails generated alongside full frames (minimal overhead)
- Google Vision API called from Modal for OCR
- Modal scales to 0 when idle — pay only for processing time
- Prefect task wraps Modal call (waits for completion)
- User blocked from video during crop + inference step

### Scaling
- **Phase 1**: Single api instance (~512MB), working copies on local disk
- **Phase 2**: Sticky sessions by video_id, multiple instances
- **Phase 3**: Consistent hashing for video_id → instance mapping
- Large files stay off-instance (Wasabi), enabling small footprint

---

## Related Documentation

- [API Endpoints](./api-endpoints.md) - Endpoint specifications
- [Sync Protocol Reference](../data-architecture/sync-protocol.md) - CR-SQLite WebSocket protocol
- [SQLite Database Reference](../data-architecture/sqlite-databases.md) - Database schemas
- [Supabase Schema Reference](../data-architecture/supabase-schema.md) - PostgreSQL tables
