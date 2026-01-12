# API Endpoints

**Date:** 2026-01-11
**Updated:** CR-SQLite sync model for layout.db and captions.db

## Base URL

```
https://api.captiona.cc/v1
```

All endpoints require `Authorization: Bearer <supabase_jwt>` header.
Tenant isolation enforced via `tenant_id` claim in JWT.

---

## Sync Architecture Overview

Client-facing databases (`layout.db`, `captions.db`) use CR-SQLite for synchronization:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Sync Flow                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. GET /database/{db}/state     → Check version, lock status               │
│  2. POST /database/{db}/lock     → Acquire lock, get WebSocket URL          │
│  3. GET /database/{db}/download  → Presigned URL for .db.gz (if needed)     │
│  4. WebSocket /sync/{db}         → Real-time change sync                    │
│  5. DELETE /database/{db}/lock   → Release lock (optional, auto-expires)    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

REST endpoints remain for:
- **Read-only data**: Stats, preferences, presigned URLs for images/chunks
- **Admin operations**: Database status, schema inspection

---

## Database Sync Endpoints

### 1. Database State

```
GET /videos/{videoId}/database/{db}/state
```

Get current database state including version and lock info.

| Path Param | Type | Description |
|------------|------|-------------|
| `db` | string | `layout` or `captions` |

Response:
```json
{
  "serverVersion": 42,
  "wasabiVersion": 42,
  "wasabiSynced": true,
  "lockHolderUserId": "uuid-or-null",
  "lockHolderIsYou": false,
  "lockType": "client",
  "lockedAt": "2026-01-11T10:30:00Z"
}
```

**Client logic:**
- If `lockHolderUserId` is null → can acquire lock
- If `lockHolderIsYou` is true → can take over session (automatic handoff)
- If `lockHolderUserId` is someone else → show read-only or wait

---

### 2. Acquire Lock

```
POST /videos/{videoId}/database/{db}/lock
```

Acquire editing lock for a database. If same user already has lock, performs automatic session handoff.

Response (lock granted):
```json
{
  "granted": true,
  "websocketUrl": "wss://api.captiona.cc/v1/videos/{videoId}/sync/{db}",
  "needsDownload": true,
  "serverVersion": 42
}
```

Response (lock denied - another user):
```json
{
  "granted": false,
  "lockHolderUserId": "other-user-uuid",
  "lockedAt": "2026-01-11T10:30:00Z"
}
```

**`needsDownload`:**
- `true` → Server has no working copy, client should download from Wasabi
- `false` → Server has working copy, client will receive state via WebSocket

---

### 3. Database Download URL

```
GET /videos/{videoId}/database/{db}/download-url
```

Get presigned URL for downloading database from Wasabi (gzip compressed).

Response:
```json
{
  "url": "https://s3.wasabisys.com/caption-acc-prod/.../layout.db.gz?...",
  "expiresIn": 900,
  "version": 42
}
```

**Note:** Only needed when `needsDownload: true` from lock acquisition.

---

### 4. Release Lock

```
DELETE /videos/{videoId}/database/{db}/lock
```

Explicitly release lock. Optional - locks auto-expire after idle timeout.

Response:
```json
{
  "released": true
}
```

---

### 5. WebSocket Sync

```
WebSocket /videos/{videoId}/sync/{db}
```

Real-time bidirectional sync using CR-SQLite change protocol.

**Connection:** Requires valid JWT. Connection authenticated on open.

**Messages:** See [Sync Protocol Reference](../data-architecture/sync-protocol.md) for full protocol.

Summary:
| Direction | Type | Purpose |
|-----------|------|---------|
| Client→Server | `sync` | Send local changes |
| Server→Client | `ack` | Acknowledge changes applied |
| Server→Client | `server_update` | Push server-side changes |
| Server→Client | `lock_changed` | Lock type changed (client↔server) |
| Server→Client | `session_transferred` | Another tab took over |
| Server→Client | `error` | Sync error |

---

## Video Endpoints

### 6. Stats

```
GET /videos/{videoId}/stats
```

Get video stats and progress. Read-only, no lock required.

Response:
```json
{
  "totalFrames": 1000,
  "coveredFrames": 750,
  "progressPercent": 75,
  "annotationCount": 42,
  "needsTextCount": 5,
  "processingStatus": "ready"
}
```

---

### 7. Preferences

```
GET /videos/{videoId}/preferences
PUT /videos/{videoId}/preferences
```

Get/update video preferences (text_size, padding_scale, text_anchor).

PUT body:
```json
{
  "textSize": 24,
  "paddingScale": 1.2,
  "textAnchor": "center"
}
```

---

## Direct Wasabi Access

### 8. S3 Credentials (STS) - Edge Function

```
GET /functions/v1/captionacc-s3-credentials
```

Get temporary AWS credentials for direct Wasabi S3 access (Supabase Edge Function). Credentials are scoped to the tenant's `client/` paths only (read-only).

Response:
```json
{
  "credentials": {
    "accessKeyId": "ASIA...",
    "secretAccessKey": "...",
    "sessionToken": "..."
  },
  "expiration": "2026-01-11T23:00:00Z",
  "bucket": "caption-acc-prod",
  "region": "us-east-1",
  "endpoint": "https://s3.us-east-1.wasabisys.com",
  "prefix": "{tenant_id}/client/*"
}
```

**Client usage:**
```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: creds.region,
  endpoint: creds.endpoint,
  credentials: {
    accessKeyId: creds.credentials.accessKeyId,
    secretAccessKey: creds.credentials.secretAccessKey,
    sessionToken: creds.credentials.sessionToken,
  },
});

// Direct access to any media file - no API round-trip
const chunk = await s3.send(new GetObjectCommand({
  Bucket: creds.bucket,
  Key: `${tenantId}/client/videos/${videoId}/cropped_frames_v1/modulo_4/chunk_0042.webm`,
}));
```

**Access scope:** (`{tenant_id}/client/*`)
- ✅ `client/videos/{id}/video.mp4` - Original video
- ✅ `client/videos/{id}/full_frames/*.jpg` - Frame images
- ✅ `client/videos/{id}/cropped_frames_v*/*.webm` - Video chunks
- ✅ `client/videos/{id}/layout.db.gz` - Layout database (use presigned URLs for versioning)
- ✅ `client/videos/{id}/captions.db.gz` - Captions database (use presigned URLs for versioning)
- ❌ `server/*` - Server-only, never accessible

**When to use:**
- High-volume media access (chunks, frames)
- Caption editor streaming
- Layout page thumbnails

**When NOT to use:**
- Database downloads (use sync API for versioning)
- One-off large file downloads (use presigned URL)

---

### 9. Upload URL (Edge Function)

```
POST /functions/v1/captionacc-presigned-upload
```

Get presigned URL for direct Wasabi upload (Supabase Edge Function).

Body:
```json
{
  "filename": "video.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 104857600
}
```

Response:
```json
{
  "uploadUrl": "https://wasabi.../...",
  "videoId": "uuid",
  "storageKey": "{tenant_id}/client/videos/{video_id}/video.mp4",
  "expiresAt": "2026-01-11T11:00:00Z"
}
```

---

## Legacy Presigned URL Endpoints

These endpoints remain for backwards compatibility but STS credentials (above) are preferred for high-volume access.

### 10. Image URLs

```
GET /videos/{videoId}/image-urls?frames=0,10,20&size=thumb
```

Get presigned URLs for frame images (layout page). Consider using STS credentials instead for better performance.

| Query Param | Type | Description |
|-------------|------|-------------|
| `frames` | string | Comma-separated frame indices |
| `size` | string | `thumb` (default) or `full` |

Response:
```json
{
  "urls": {
    "0": "https://wasabi.../client/full_frames/frame_0_thumb.jpg?signature=...",
    "10": "https://wasabi.../client/full_frames/frame_10_thumb.jpg?signature=..."
  },
  "expiresIn": 900
}
```

---

### 11. Frame Chunks

```
GET /videos/{videoId}/frame-chunks?modulo=4&indices=0,4,8,12
```

Get presigned URLs for VP9 WebM video chunks. Consider using STS credentials instead for better performance.

| Query Param | Type | Description |
|-------------|------|-------------|
| `modulo` | int | Sampling level: `16`, `4`, or `1` |
| `indices` | string | Comma-separated frame indices |

Response:
```json
{
  "chunks": [
    {
      "chunkIndex": 0,
      "signedUrl": "https://wasabi.../client/cropped_frames_v1/modulo_4/chunk_0000.webm?signature=...",
      "frameIndices": [0, 4, 8, 12]
    }
  ]
}
```

**Hierarchical loading:**
- `modulo=16`: Coarsest, every 16th frame, large range
- `modulo=4`: Medium, every 4th frame (excluding mod-16)
- `modulo=1`: Finest, all remaining frames

---

## Admin Endpoints

### 11. Database Status

```
GET /admin/databases
```

List databases with status and version info.

| Query Param | Type | Description |
|-------------|------|-------------|
| `status` | string | `synced`, `pending`, `stale` |
| `hasLock` | bool | Filter by lock status |
| `search` | string | Video ID search |

Response:
```json
{
  "databases": [
    {
      "videoId": "uuid",
      "databaseName": "layout",
      "serverVersion": 42,
      "wasabiVersion": 40,
      "lockHolderUserId": "uuid",
      "lastActivityAt": "2026-01-11T10:30:00Z"
    }
  ]
}
```

---

### 12. Force Wasabi Sync

```
POST /admin/databases/{videoId}/{db}/sync
```

Force upload working copy to Wasabi (admin recovery tool).

Response:
```json
{
  "synced": true,
  "previousVersion": 40,
  "newVersion": 42
}
```

---

## Endpoint Summary

| # | Endpoint | Methods | Purpose |
|---|----------|---------|---------|
| 1 | `/videos/{id}/database/{db}/state` | GET | Database version and lock status |
| 2 | `/videos/{id}/database/{db}/lock` | POST, DELETE | Acquire/release editing lock |
| 3 | `/videos/{id}/database/{db}/download-url` | GET | Presigned URL for database download |
| 4 | `/videos/{id}/sync/{db}` | WebSocket | CR-SQLite real-time sync |
| 5 | `/videos/{id}/stats` | GET | Video stats and progress |
| 6 | `/videos/{id}/preferences` | GET, PUT | Video preferences |
| 7 | `/videos/{id}/image-urls` | GET | Frame image presigned URLs (legacy) |
| 8 | `/videos/{id}/frame-chunks` | GET | VP9 chunk presigned URLs (legacy) |
| 9 | `/admin/databases` | GET | Database status list |
| 10 | `/admin/databases/{id}/{db}/sync` | POST | Force Wasabi sync |
| 11 | `/admin/locks/cleanup` | POST | Release stale locks |

Plus Edge Functions:
- `POST /functions/v1/captionacc-presigned-upload` - Upload URL generation
- `GET /functions/v1/captionacc-s3-credentials` - STS credentials for direct Wasabi access
