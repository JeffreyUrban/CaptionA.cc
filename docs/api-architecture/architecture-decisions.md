# Architecture Decisions

**Date:** 2026-01-10
**Context:** Migration from React Router SSR to SPA + FastAPI backend

## Services

| Service | Function | Infra | Cost |
|---------|----------|-------|------|
| **api** | Sync: CRUD, layout analysis, presigned URLs, trigger jobs | Fly.io (auto-stop) | Pay for usage |
| **prefect** | Job orchestration | Fly.io (auto-stop) | Pay for usage |
| **modal-gpu** | Async: full_frames + OCR, crop + inference | Modal | Per-video, scales to 0 |

All services scale to zero when idle.

## Data Flow

```
1. UPLOAD
   Client ──presigned URL──▶ Wasabi

2. FULL FRAMES + OCR (async, Modal)
   modal-gpu: Wasabi (video) → full_frames (GPU FFmpeg) → OCR (Google Vision) → SQLite → Wasabi

3. USER SESSION (sync, Fly.io)
   api: Wasabi (SQLite) ↔ LRU cache ↔ layout analysis
        Wasabi (images) → presigned URLs → Client
        Layout view: boxes JSON → client-side Canvas

4. CROP + INFERENCE (async, Modal, blocks user)
   modal-gpu: Wasabi (video) + bounds → crop_frames (GPU FFmpeg) → inference → results → Wasabi
   api: process results → captions.db → unblock user
```

## Key Decisions

### Authentication
- SPA authenticates directly with Supabase, receives JWT
- JWT contains `tenant_id` claim
- FastAPI validates JWT signature, extracts `tenant_id`
- All Wasabi paths scoped to `/{tenant_id}/*`
- Presigned upload URLs via Supabase Edge Functions (keeps Wasabi creds isolated)
- Direct Supabase queries from SPA for video list, user profile (RLS enforced)

### API Style
- Hybrid REST/RPC (not GraphQL)
- REST for resources: annotations, preferences, boxes, stats
- `/actions/*` namespace for operations: bulk-annotate, analyze-layout, trigger-crop
- Everything scoped under `/videos/{videoId}`
- Query params for filtering instead of separate endpoints
- ~15 consolidated endpoints instead of 54

### Realtime Updates
- All realtime via Supabase Realtime (no SSE from FastAPI)
- Job status stored in Supabase, updated by Prefect webhooks
- SPA subscribes to `videos` table changes
- Simplifies api service (no connection management)

### Prefect Hosting
- Self-hosted on Fly.io (auto-stop)
- Prefect Cloud free tier too limited (5 deployments, have 10+ flows)
- Prefect Cloud paid tier too expensive ($100/mo for 20 deployments)
- Self-hosted: ~$3/mo, unlimited deployments

### Storage
- **Videos, frames**: Wasabi (presigned URLs to client)
- **SQLite DBs**: Wasabi, LRU cached on api instance
- **Inference runs**: Archived in Wasabi (`/{tenant}/{video}/inference_runs/`)
- **captions.db**: Only distilled values from latest inference run

### Layout View
- Server sends box data as compact binary/JSON (coordinates + color index)
- Client renders via Canvas (10k boxes)
- No server-side image rendering

### Video Processing (Modal)
- All heavy compute on Modal: full_frames, OCR, crop_frames, inference
- GPU FFmpeg for frame extraction
- Google Vision API called from Modal for OCR
- Modal scales to 0 when idle — pay only for processing time
- Prefect task wraps Modal call (waits for completion)
- User blocked from video during crop + inference step

### Scaling
- **Phase 1**: Single api instance (~512MB), SQLite LRU cache
- **Phase 2**: Sticky sessions, multiple instances
- **Phase 3**: Consistent hashing by user_id
- Large files stay off-instance (Wasabi), enabling small footprint

