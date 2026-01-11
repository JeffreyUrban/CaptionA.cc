# Architecture Decisions

**Date:** 2026-01-11
**Context:** Migration from React Router SSR to SPA + FastAPI backend

## Services

| Service | Function | Infra | Cost |
|---------|----------|-------|------|
| **api** | Sync: CRUD, layout analysis, presigned URLs | Fly.io (auto-stop) | Pay for usage |
| **prefect** | Job orchestration | Fly.io (auto-stop) | Pay for usage |
| **modal-gpu** | Async: full_frames + OCR, crop + inference | Modal | Per-video, scales to 0 |

All services scale to zero when idle.

## Data Flow

```
1. UPLOAD
   Client ──presigned URL──▶ Wasabi

2. FULL FRAMES + OCR (async, Modal)
   modal-gpu: Wasabi (video) → full_frames (GPU FFmpeg) → thumbnails → OCR (Google Vision) → SQLite → Wasabi

3. USER SESSION (sync, Fly.io)
   api: Wasabi (SQLite) ↔ LRU cache ↔ layout analysis
        Wasabi (images) → presigned URLs → Client
        Layout view: boxes JSON → client-side Canvas

4. CROP + INFERENCE (async, Modal, blocks user)
   modal-gpu: Wasabi (video) + bounds → crop_frames (GPU FFmpeg) → inference → results → Wasabi
   api: process results → captions.db → unblock user
```

## Key Decisions

### Authentication & Tenant Isolation
- **JWT flow**: SPA authenticates with Supabase → receives JWT (1hr default, auto-refresh)
- **JWT validation**: FastAPI validates signature (HS256) with Supabase secret, audience = "authenticated"
- **Required claims**: `sub` (user_id), `tenant_id` - missing either returns 401
- **Direct Supabase queries**: SPA queries video list, user profile directly (RLS enforced)

**Wasabi tenant isolation:**
- All S3 paths scoped: `{tenant_id}/videos/{video_id}/...`
- `tenant_id` extracted from validated JWT, never from request params
- Presigned URLs (15 min expiry) generated server-side with Wasabi credentials
- Client cannot forge paths - signature would be invalid
- Upload URLs via Supabase Edge Functions (keeps Wasabi creds isolated from API)

### API Style
- REST for resources: captions, layout, preferences, stats
- Everything scoped under `/videos/{videoId}`
- Query params for filtering instead of separate endpoints
- ~9 consolidated endpoints instead of 54
- Client-facing only (no internal service endpoints)
- Server-side operations (layout analysis, crop+inference) triggered by state changes, not client requests

### Realtime Updates (Event-Driven)
- All realtime via Supabase Realtime (no SSE from FastAPI)
- Jobs write status directly to Supabase (no internal API endpoints)
- SPA subscribes to `videos` table changes
- Server-side jobs triggered by state changes (e.g., layout approval triggers crop+inference)
- Simplifies api service (no connection management, no job orchestration endpoints)

### Prefect Hosting
- Self-hosted on Fly.io (auto-stop)
- Prefect Cloud free tier too limited (5 deployments, have 10+ flows)
- Prefect Cloud paid tier too expensive ($100/mo for 20 deployments)
- Self-hosted: ~$3/mo, unlimited deployments

### Storage
- **Videos**: Wasabi (presigned URLs for upload)
- **Full frames**: Wasabi, presigned URLs to client for detailed view (~500KB each)
- **Thumbnails**: Wasabi, presigned URLs to client for frame strip (~10KB each, ~100px wide)
- **SQLite DBs**: Wasabi, LRU cached on api instance
- **Inference runs**: Archived in Wasabi (`/{tenant}/{video}/inference_runs/`)
- **captions.db**: Only distilled values from latest inference run

### Layout State Sync
- **Initial load**: Client fetches full state via `GET /layout` (version + boxes + bounds + frameConfidences)
- **Updates**: Server pushes diffs to `layout_state` table via Supabase Realtime
- **Diff format**: `{ version, diff: { boxLabels, frameConfidences } }` (sparse, only changed values)
- **Large changes**: Server sends `{ version, diff: "reset" }` instead of enumerating changes
- **Client logic**: If `diff === "reset"` or version gap detected, fetch full state
- **No acks**: Client self-heals by detecting version gaps
- **Threshold**: Server decides when to send "reset" (e.g., >100 box changes)

### Layout View
- Client renders boxes via Canvas (10k boxes)
- No server-side image rendering
- Bounds (crop, selection) computed server-side, not client-submitted

### Frame Images (Layout Page)
- **Thumbnails generated during OCR job**: Ready when user arrives at layout page
- **Presigned URLs fetched on-demand**: Client requests URLs for frames it needs
- **Short-lived URLs**: ~15 min expiry, fetched close to use for security
- **Workflow**:
  1. Client gets `frameConfidences` from layout state
  2. Client selects ~10 frames with lowest minConfidence
  3. Client requests presigned URLs for those frames
  4. As confidences update, client requests URLs for new frames rotating into view

### Frame Chunks (Caption Editing)
- **VP9 WebM chunks**: 32 cropped frames per chunk, generated during crop+inference
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
- **Phase 1**: Single api instance (~512MB), SQLite LRU cache
- **Phase 2**: Sticky sessions, multiple instances
- **Phase 3**: Consistent hashing by user_id
- Large files stay off-instance (Wasabi), enabling small footprint

