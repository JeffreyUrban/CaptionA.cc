# API Endpoints (Consolidated)

**Date:** 2026-01-10
**Consolidation:** 54 routes → 15 endpoints

## Base URL

```
https://api.captiona.cc/v1
```

All endpoints require `Authorization: Bearer <supabase_jwt>` header.
Tenant isolation enforced via `tenant_id` claim in JWT.

---

## Video Endpoints

### 1. Annotations

```
GET /videos/{videoId}/annotations
```
List annotations with optional filters.

| Query Param | Type | Description |
|-------------|------|-------------|
| `start` | int | Start frame index |
| `end` | int | End frame index |
| `filter` | string | `needs-text`, `pending`, `confirmed` |
| `navigate` | string | `prev` or `next` (requires `from`) |
| `from` | int | Annotation ID for navigation |

```
POST /videos/{videoId}/annotations
```
Create annotation. Body: `{ start_frame_index, end_frame_index, boundary_state }`

```
PUT /videos/{videoId}/annotations/{id}
```
Update annotation with overlap resolution. Body: `{ start_frame_index, end_frame_index, boundary_state, text? }`

```
DELETE /videos/{videoId}/annotations/{id}
```
Delete annotation.

---

### 2. Boxes

```
GET /videos/{videoId}/boxes?frame={frameIndex}
```
Get OCR boxes for a frame with predictions and user annotations.

```
PUT /videos/{videoId}/boxes?frame={frameIndex}
```
Save box annotations. Body: `{ annotations: [{ box_index, status }] }`

---

### 3. Layout

```
GET /videos/{videoId}/layout
```
Get layout config (crop bounds, selection bounds, params) and analysis boxes.

```
PUT /videos/{videoId}/layout
```
Update layout config. Body: `{ crop_bounds?, selection_bounds?, selection_mode?, layout_params? }`

---

### 4. Preferences

```
GET /videos/{videoId}/preferences
```
Get video preferences (text_size, padding_scale, text_anchor).

```
PUT /videos/{videoId}/preferences
```
Update preferences. Body: `{ text_size?, padding_scale?, text_anchor? }`

---

### 5. Stats

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

## Action Endpoints

### 6. Bulk Annotate

```
POST /videos/{videoId}/actions/bulk-annotate
```
Bulk annotate boxes in a rectangle.

Body:
```json
{
  "rectangle": { "left": 0, "top": 0, "right": 100, "bottom": 100 },
  "action": "mark_in" | "mark_out" | "clear",
  "frame": 123,           // single frame
  "all_frames": false     // or all analysis frames
}
```

---

### 7. Analyze Layout

```
POST /videos/{videoId}/actions/analyze-layout
```
Run layout analysis (Bayesian model on ~10k boxes). Synchronous, returns updated predictions.

Response:
```json
{
  "success": true,
  "boxes_analyzed": 10000,
  "processing_time_ms": 2500
}
```

---

### 8. Calculate Predictions

```
POST /videos/{videoId}/actions/calculate-predictions
```
Train model and cache predictions for all boxes.

---

### 9. Trigger Processing

```
POST /videos/{videoId}/actions/trigger-processing
```
Trigger crop + inference pipeline (Modal). User blocked until complete.

Body:
```json
{
  "type": "crop-and-infer"
}
```

---

### 10. Retry Processing

```
POST /videos/{videoId}/actions/retry
```
Retry failed processing step.

Body:
```json
{
  "step": "full-frames" | "ocr" | "crop" | "inference"
}
```

---

## Presigned URLs (Edge Function)

### 11. Upload URL

```
POST /functions/v1/presigned-upload
```
Get presigned URL for direct Wasabi upload.

Body: `{ filename, content_type, size_bytes }`

Response: `{ upload_url, video_id, expires_at }`

---

### 12. Image URLs

```
GET /videos/{videoId}/image-urls?frames=0,10,20
```
Get presigned URLs for frame images.

Response:
```json
{
  "urls": {
    "0": "https://wasabi.../frame_0.jpg?signature=...",
    "10": "https://wasabi.../frame_10.jpg?signature=..."
  }
}
```

---

## Admin Endpoints

### 13. Database Status

```
GET /admin/databases
```
List databases with status and version info.

| Query Param | Type | Description |
|-------------|------|-------------|
| `status` | string | `current`, `outdated`, `incomplete` |
| `search` | string | Video ID search |

---

### 14. Database Repair

```
POST /admin/databases/repair
```
Repair/migrate databases to target schema.

Body: `{ target_version?, force? }`

---

### 15. Security Audit

```
GET /admin/security
```
Get security audit logs.

| Query Param | Type | Description |
|-------------|------|-------------|
| `view` | string | `critical`, `attacks`, `recent`, `metrics` |
| `hours` | int | Time window |

---

## Summary

| # | Endpoint | Methods | Purpose |
|---|----------|---------|---------|
| 1 | `/videos/{id}/annotations` | GET, POST | List/create annotations |
| 2 | `/videos/{id}/annotations/{id}` | PUT, DELETE | Update/delete annotation |
| 3 | `/videos/{id}/boxes` | GET, PUT | Frame box annotations |
| 4 | `/videos/{id}/layout` | GET, PUT | Layout config |
| 5 | `/videos/{id}/preferences` | GET, PUT | Video preferences |
| 6 | `/videos/{id}/stats` | GET | Progress and stats |
| 7 | `/videos/{id}/actions/bulk-annotate` | POST | Bulk box operations |
| 8 | `/videos/{id}/actions/analyze-layout` | POST | Run layout analysis |
| 9 | `/videos/{id}/actions/calculate-predictions` | POST | Train prediction model |
| 10 | `/videos/{id}/actions/trigger-processing` | POST | Start crop + inference |
| 11 | `/videos/{id}/actions/retry` | POST | Retry failed step |
| 12 | `/videos/{id}/image-urls` | GET | Presigned image URLs |
| 13 | `/admin/databases` | GET | Database status |
| 14 | `/admin/databases/repair` | POST | Repair databases |
| 15 | `/admin/security` | GET | Security audit logs |

Plus Edge Function: `POST /functions/v1/presigned-upload`
