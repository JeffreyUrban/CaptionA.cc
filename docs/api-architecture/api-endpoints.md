# API Endpoints (Consolidated)

**Date:** 2026-01-11
**Consolidation:** 54 routes → 9 endpoints

## Base URL

```
https://api.captiona.cc/v1
```

All endpoints require `Authorization: Bearer <supabase_jwt>` header.
Tenant isolation enforced via `tenant_id` claim in JWT.

---

## Video Endpoints

### 1. Captions

```
GET /videos/{videoId}/captions
```
List captions with optional filters.

| Query Param | Type | Description |
|-------------|------|-------------|
| `start` | int | Start frame index |
| `end` | int | End frame index |
| `filter` | string | `needs-text`, `pending`, `confirmed` |
| `navigate` | string | `prev` or `next` (requires `from`) |
| `from` | int | Annotation ID for navigation |

```
POST /videos/{videoId}/captions
```
Create caption. Body: `{ start_frame_index, end_frame_index, boundary_state }`

```
PUT /videos/{videoId}/captions/{id}
```
Update caption with overlap resolution. Body: `{ start_frame_index, end_frame_index, boundary_state, text? }`

```
DELETE /videos/{videoId}/captions/{id}
```
Delete caption.

---

### 2. Layout

Layout state uses a hybrid sync pattern:
- **Initial load**: Client fetches full state via GET
- **Updates**: Server pushes diffs via Supabase Realtime
- **Large changes**: Server sends `"reset"` instead of diff, client fetches full state

#### GET /videos/{videoId}/layout

Get full layout state (initial load or after reset).

Response:
```json
{
  "version": 42,
  "boxes": [...],
  "cropBounds": { "left": 0.1, "top": 0.2, "right": 0.8, "bottom": 0.9 },
  "selectionBounds": { ... },
  "frameConfidences": [
    { "frame": 0, "minConfidence": 0.92 },
    { "frame": 10, "minConfidence": 0.45 }
  ]
}
```

#### PUT /videos/{videoId}/layout?frame={frameIndex}

Annotate boxes on a single frame. Client calculates box indices (e.g., from click or rectangle select).

Body:
```json
{
  "boxAnnotation": [
    { "boxIndex": 0, "label": "in" },
    { "boxIndex": 1, "label": "out" }
  ]
}
```

#### POST /videos/{videoId}/layout

Bulk annotate boxes across all frames using relative rectangle coordinates.

Body:
```json
{
  "layoutAnnotation": {
    "rectangle": { "left": 0.1, "top": 0.8, "right": 0.9, "bottom": 1.0 },
    "label": "clear" | "out"
  }
}
```

Response: `{ "version": 43, "boxesModified": 10423, "framesAffected": 847 }`

#### Supabase Realtime: layout_state table

Client subscribes to changes. Server writes diffs after state changes.

```json
// Small update - client applies diff
{
  "version": 43,
  "diff": {
    "boxLabels": [{ "index": 0, "label": "out" }],
    "frameConfidences": [{ "frame": 10, "minConfidence": 0.87 }]
  }
}

// Large update - client fetches full state
{ "version": 44, "diff": "reset" }
```

Client logic:
```
if (diff === "reset" || version !== myVersion + 1) {
  fetchFullState()  // GET /layout
} else {
  applyDiff(diff)
  myVersion = version
}
```

---

### 3. Preferences

```
GET /videos/{videoId}/preferences
```
Get video preferences (text_size, padding_scale, text_anchor).

```
PUT /videos/{videoId}/preferences
```
Update preferences. Body: `{ text_size?, padding_scale?, text_anchor? }`

---

### 4. Stats

```
GET /videos/{videoId}/stats
```
Get video stats and progress.

Response:
```json
{
  "total_frames": 1000,
  "covered_frames": 750,
  "progress_percent": 75,
  "annotation_count": 42,
  "needs_text_count": 5,
  "processing_status": "ready"
}
```

---

## Presigned URLs (Edge Function)

### 5. Upload URL

```
POST /functions/v1/presigned-upload
```
Get presigned URL for direct Wasabi upload.

Body: `{ filename, content_type, size_bytes }`

Response: `{ upload_url, video_id, expires_at }`

---

### 6. Image URLs

```
GET /videos/{videoId}/image-urls?frames=0,10,20&size=thumb
```

Get presigned URLs for frame images. Fetch URLs close to when images are needed (short-lived for security).

| Query Param | Type | Description |
|-------------|------|-------------|
| `frames` | string | Comma-separated frame indices |
| `size` | string | `thumb` (default) or `full` |

Response:
```json
{
  "urls": {
    "0": "https://wasabi.../frame_0_thumb.jpg?signature=...",
    "10": "https://wasabi.../frame_10_thumb.jpg?signature=..."
  },
  "expiresIn": 900
}
```

**Typical workflow (layout page):**
1. Client gets layout state with `frameConfidences`
2. Client selects ~10 frames with lowest minConfidence
3. Client requests `GET /image-urls?frames=5,42,108&size=thumb`
4. Diff arrives → 2 frames rotate in/out of bottom 10
5. Client requests URLs for just the 2 new frames

**Size options:**
- `thumb`: ~100px wide thumbnails for frame strip (~10KB each)
- `full`: Full resolution frames for detailed view (~500KB each)

---

### 7. Frame Chunks

```
GET /videos/{videoId}/frame-chunks?modulo=4&indices=0,4,8,12
```

Get presigned URLs for VP9 WebM video chunks containing cropped frames (caption editing workflow).

| Query Param | Type | Description |
|-------------|------|-------------|
| `modulo` | int | Sampling level: `16`, `4`, or `1` |
| `indices` | string | Comma-separated frame indices to load |

Response:
```json
{
  "chunks": [
    {
      "chunkIndex": 0,
      "signedUrl": "https://wasabi.../chunk_0_mod4.webm?signature=...",
      "frameIndices": [0, 4, 8, 12]
    }
  ]
}
```

**Hierarchical loading strategy:**
- `modulo=16`: Coarsest, every 16th frame, large range (±512 frames)
- `modulo=4`: Medium, every 4th frame (excluding mod-16), medium range (±128 frames)
- `modulo=1`: Finest, all remaining frames, small range (±32 frames)

**Client-side processing:**
1. Fetch VP9 WebM chunk from presigned URL
2. Load into video element
3. Seek to frame position, extract via canvas
4. Cache extracted frames in memory (LRU with pinning)

**Chunk structure:**
- 32 frames per chunk
- Non-duplicating: each frame belongs to exactly one modulo level
- Frames at modulo boundaries included only in coarser level

---

## Admin Endpoints

### 8. Database Status

```
GET /admin/databases
```
List databases with status and version info.

| Query Param | Type | Description |
|-------------|------|-------------|
| `status` | string | `current`, `outdated`, `incomplete` |
| `search` | string | Video ID search |

---

## Summary

| # | Endpoint | Methods | Purpose |
|---|----------|---------|---------|
| 1 | `/videos/{id}/captions` | GET, POST | List/create captions |
| 2 | `/videos/{id}/captions/{id}` | PUT, DELETE | Update/delete caption |
| 3 | `/videos/{id}/layout` | GET, PUT, POST | Layout config + box annotations |
| 4 | `/videos/{id}/preferences` | GET, PUT | Video preferences |
| 5 | `/videos/{id}/stats` | GET | Progress and stats |
| 6 | `/videos/{id}/image-urls` | GET | Full frames + thumbnails (layout page) |
| 7 | `/videos/{id}/frame-chunks` | GET | VP9 cropped frame chunks (caption editing) |
| 8 | `/admin/databases` | GET | Database status |

Plus Edge Function: `POST /functions/v1/presigned-upload`
