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
│  3. Client downloads .db.gz from Wasabi using STS credentials (if needed)   │
│  4. WebSocket /sync/{db}         → Real-time change sync                    │
│  5. DELETE /database/{db}/lock   → Release lock (optional, auto-expires)    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

REST endpoints remain for:
- **Read-only data**: Stats, preferences
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
  "serverVersion": 42,
  "wasabiVersion": 42
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
- `true` → Server has no working copy, client downloads from Wasabi using STS credentials
- `false` → Server has working copy, client will receive state via WebSocket

**`wasabiVersion`:** The version of the database in Wasabi. When `needsDownload: true`, client downloads this version and uses it as the starting point for CR-SQLite sync.

**S3 key pattern:** `{tenant_id}/client/videos/{video_id}/{db}.db.gz`

---

### 3. Release Lock

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

### 4. WebSocket Sync

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

### 5. Stats

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

### 6. Preferences

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

### 7. S3 Credentials (STS) - Edge Function

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
  "bucket": "captionacc-prod",
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
- ✅ `client/videos/{id}/layout.db.gz` - Layout database
- ✅ `client/videos/{id}/captions.db.gz` - Captions database
- ❌ `server/*` - Server-only, never accessible

**When to use:**
- All media access (chunks, frames, video)
- Database downloads (when `needsDownload: true` from lock API)
- Caption editor streaming
- Layout page thumbnails

---

### 8. Upload URL (Edge Function)

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

## Admin Endpoints

### 9. Database Status

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

### 10. Force Wasabi Sync

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
| 3 | `/videos/{id}/sync/{db}` | WebSocket | CR-SQLite real-time sync |
| 4 | `/videos/{id}/stats` | GET | Video stats and progress |
| 5 | `/videos/{id}/preferences` | GET, PUT | Video preferences |
| 6 | `/admin/databases` | GET | Database status list |
| 7 | `/admin/databases/{id}/{db}/sync` | POST | Force Wasabi sync |
| 8 | `/admin/locks/cleanup` | POST | Release stale locks |

Plus Edge Functions:
- `POST /functions/v1/captionacc-presigned-upload` - Upload URL generation
- `GET /functions/v1/captionacc-s3-credentials` - STS credentials for direct Wasabi access (media + databases)
