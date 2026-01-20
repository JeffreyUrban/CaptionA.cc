# CaptionA.cc Data Architecture

This document describes the data architecture for CaptionA.cc, covering the three primary storage systems and how data flows between them.

## Overview

CaptionA.cc uses a hybrid storage architecture optimized for different workloads:

| Storage System | Purpose | Data Types |
|----------------|---------|------------|
| **Supabase (PostgreSQL)** | Metadata catalog, multi-tenant access control, search | Video records, user profiles, access tiers, usage metrics |
| **Wasabi S3** | Cost-effective object storage for large files | Videos, SQLite databases, frame images, WebM chunks |
| **SQLite Databases** | Per-video structured data, stored in Wasabi | OCR results, layout annotations, captions |

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                           Data Architecture                                    │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌──────────────┐    ┌─────────────────────────────────┐    ┌──────────────┐  │
│  │   Supabase   │    │           Wasabi S3             │    │    Server    │  │
│  │ (PostgreSQL) │    │                                 │    │  Processing  │  │
│  ├──────────────┤    ├─────────────────────────────────┤    ├──────────────┤  │
│  │ • Video      │    │  client/ (STS credentials):     │    │ • ML models  │  │
│  │   catalog    │◄──►│  • video.mp4                    │◄──►│ • OCR        │  │
│  │ • User       │    │  • full_frames/*.jpg            │    │ • Inference  │  │
│  │   profiles   │    │  • cropped_frames_v*/*.webm     │    │              │  │
│  │ • Sync state │    │  • layout.db.gz (CR-SQLite)     │    │ server/:     │  │
│  │ • Search     │    │  • captions.db.gz (CR-SQLite)   │    │ • ocr-server │  │
│  │   index      │    │                                 │    │   .db        │  │
│  └──────────────┘    └─────────────────────────────────┘    │ • layout-    │  │
│                                                              │   server.db  │  │
│  Metadata & Locks      File Storage (Free Egress)           └──────────────┘  │
│  Multi-tenant RLS      Path-based access control            Internal Processing│
└───────────────────────────────────────────────────────────────────────────────┘
```

## Storage Path Organization

Wasabi paths are organized with **access level at the top** for simple IAM policies:

```
{tenant_id}/
├── client/                        # Tenant-accessible via STS credentials
│   └── videos/{video_id}/
│       ├── video.mp4              # Original video
│       ├── layout.db.gz           # CR-SQLite synced
│       ├── captions.db.gz         # CR-SQLite synced
│       ├── full_frames/           # Frame images (layout page)
│       └── cropped_frames_v*/     # WebM chunks (caption editor)
│
└── server/                        # Server-only (never client-accessible)
    └── videos/{video_id}/
        ├── raw-ocr.db.gz       # Full OCR results (gzip)
        └── layout-server.db.gz    # ML model, analysis params (gzip)
```

**Security principle:** Access level (`client/` vs `server/`) at the top enables simple IAM policies:
- `{tenant_id}/client/*` - Tenant gets STS credentials for read-only access
- `{tenant_id}/server/*` - Never included in any client credentials

See: [Wasabi Storage](./wasabi/)

## Client vs Server Data

Databases are split by **visibility**:

| Database | Location | Access | Sync | Purpose |
|----------|----------|--------|------|---------|
| `layout.db` | `client/` | STS credentials | CR-SQLite (bidirectional) | Boxes, annotations, crop region |
| `captions.db` | `client/` | STS credentials | CR-SQLite (client→server) | Caption frame extents, text |
| `raw-ocr.db.gz` | `server/` | None | None | Full OCR results |
| `layout-server.db.gz` | `server/` | None | None | ML model, analysis params |

**Key principle:** Client-facing databases live in `client/` alongside media. Client uses STS credentials for download; version info comes from the lock API response.

See: [SQLite Database Reference](./sqlite-databases.md)

## Storage Systems

### 1. Supabase (PostgreSQL)

Supabase serves as the **metadata layer** and **access control system**. It stores:

- **Video catalog**: Video records with storage references pointing to Wasabi
- **User management**: Profiles, tenant membership, access tiers
- **Sync state**: `video_database_state` table for CR-SQLite versioning and locks
- **Search index**: Full-text search across OCR text and captions
- **Processing state**: Inference job queue, cropped frames versions

Multi-tenant isolation is enforced via Row-Level Security (RLS) policies.

See: [Supabase Schema Reference](./supabase-schema.md)

### 2. Wasabi S3 Storage

Wasabi provides **cost-effective object storage** with free egress bandwidth. It stores:

- **Original videos**: `client/videos/{id}/video.mp4`
- **Full-resolution frames**: `client/videos/{id}/full_frames/*.jpg` (0.1Hz)
- **Cropped frame chunks**: `client/videos/{id}/cropped_frames_v*/modulo_*/*.webm`
- **Client databases**: `client/videos/{id}/layout.db.gz`, `captions.db.gz` (gzip compressed)
- **Server databases**: `server/videos/{id}/raw-ocr.db.gz`, `layout-server.db.gz`

Bucket: `captionacc-prod` (us-east-1)

See: [Wasabi Storage](./wasabi/)

### 3. SQLite Databases (Per-Video)

Each video has SQLite databases stored in Wasabi, split by visibility:

**Client-Facing (synced via CR-SQLite):**

| Database | Sync Direction | Content |
|----------|----------------|---------|
| `layout.db` | Bidirectional | Box positions, user annotations, server predictions, crop region |
| `captions.db` | Client → Server | Caption frame extents, text, status |

**Server-Only (internal):**

| Database | Content |
|----------|---------|
| `raw-ocr.db.gz` | Full OCR results from Google Vision API |
| `layout-server.db.gz` | Trained ML model, analysis parameters |

See: [SQLite Database Reference](./sqlite-databases.md)

## Data Flow

### Video Upload Flow

```
1. Client calls Edge Function for presigned upload URL (no video record created yet)
2. Client uploads video directly to Wasabi (client/videos/{id}/video.mp4)
   - Upload progress tracked client-side only (not visible in videos page)
3. Client calls Edge Function /confirm endpoint after upload completes
   - Edge Function creates video record in Supabase (status: 'processing')
   - Supabase INSERT webhook fires → triggers Prefect flow
4. Prefect flow: captionacc-video-initial-processing
   a. Extract full frames → client/videos/{id}/full_frames/*.jpg
   b. Run OCR → server/videos/{id}/raw-ocr.db.gz
   c. Initialize client/videos/{id}/layout.db.gz with box data from OCR
5. Video status set to 'active'
   - Video now appears in videos page with annotation statistics
```

**Key design principle:** Video record is only created AFTER upload completes, ensuring the backend never tries to process a partially uploaded file.

### Layout Annotation Flow (CR-SQLite Sync)

```
1. Client acquires lock via API → gets needsDownload + wasabiVersion
2. If needsDownload: Client downloads layout.db.gz from Wasabi using STS credentials
3. Client loads into wa-sqlite + CR-SQLite extension
4. User annotates boxes (in/out/clear) - instant local edits
5. Client syncs changes via WebSocket → Server applies → uploads to Wasabi
6. Server runs ML predictions → syncs back to client
7. User approves layout → workflow lock transitions
```

### Cropped Frames Flow

```
1. Prefect flow: crop_frames_to_webm
2. Download client/videos/{id}/video.mp4 + server/videos/{id}/layout-server.db.gz from Wasabi
3. Extract cropped frames at 10Hz using layout crop region
4. Encode as VP9/WebM chunks (hierarchical modulo levels)
5. Upload chunks to Wasabi: client/videos/{id}/cropped_frames_v{version}/modulo_{M}/chunk_NNNN.webm
6. Create cropped_frames_versions record in Supabase
7. Activate new version (archives previous)
```

### Caption Annotation Flow (CR-SQLite Sync)

```
1. Client gets STS credentials for tenant (one-time per session)
2. Client acquires lock via API → gets needsDownload + wasabiVersion
3. If needsDownload: Client downloads captions.db.gz from Wasabi using STS credentials
4. Client loads into wa-sqlite + CR-SQLite extension
5. Browser streams cropped frame chunks directly from Wasabi using STS credentials
6. User edits caption frame extents and text - instant local edits
7. Client syncs changes via WebSocket → Server validates → uploads to Wasabi
```

## Client Access Methods

| Asset Type | Access Method | Why |
|------------|---------------|-----|
| Frame chunks (`.webm`) | STS credentials | High volume, performance critical |
| Frame images (`.jpg`) | STS credentials | High volume, layout thumbnails |
| Client databases (`.db.gz`) | STS credentials | Version info from lock API |
| Original video | STS credentials | Part of client/ path |
| Server databases | None | Proprietary, server-only |

### STS Credentials (Edge Function)

```
GET /functions/v1/captionacc-s3-credentials
Authorization: Bearer <jwt>

Response:
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

Client uses credentials with S3 SDK for direct Wasabi access. No API round-trip for media.

## CR-SQLite Sync Protocol

Client and server use CR-SQLite for change tracking and synchronization:

```
Client                                    Server
──────                                    ──────
Acquire lock ─────────────────────────────► Returns needsDownload + wasabiVersion
If needsDownload:
  Download .db.gz from Wasabi (STS creds)
Load wa-sqlite + CR-SQLite
Connect WebSocket
Make local edits (instant)

Query crsql_changes table
Send changes via WebSocket ──────────────► Validate & apply
                           ◄────────────── Ack + version
                                          Upload to Wasabi (periodic)
```

**Workflow Locks:** Supabase `video_database_state` table prevents concurrent client/server writes. Client notified via WebSocket when lock state changes.

See: [Sync Protocol Reference](./sync-protocol.md)

## Storage Paths

### Wasabi Path Pattern

```
captionacc-prod/
└── {tenant_id}/
    ├── client/                              # STS credentials (tenant read-only)
    │   └── videos/{video_id}/
    │       ├── video.mp4                    # Original video
    │       ├── layout.db.gz                 # CR-SQLite synced
    │       ├── captions.db.gz               # CR-SQLite synced
    │       │
    │       ├── full_frames/                 # Full-resolution frames (0.1Hz)
    │       │   ├── frame_000000.jpg
    │       │   ├── frame_000001.jpg
    │       │   └── ...
    │       │
    │       └── cropped_frames_v{version}/   # Versioned cropped frames
    │           ├── modulo_16/               # Every 16th frame (coarsest)
    │           │   ├── chunk_0000000000.webm
    │           │   └── ...
    │           ├── modulo_4/                # Every 4th frame (medium)
    │           └── modulo_1/                # Every frame (finest)
    │
    └── server/                              # Server-only (never client-accessible)
        └── videos/{video_id}/
            ├── raw-ocr.db.gz             # Full OCR results (gzip)
            └── layout-server.db.gz          # ML model, analysis params (gzip)
```

### Local Processing Path Pattern

Server-side temporary files during processing:

```
local/processing/
└── {first_2_chars_of_uuid}/{full_uuid}/
    ├── raw-ocr.db
    ├── layout-server.db
    ├── layout.db
    └── captions.db
```

## Related Documentation

- [SQLite Database Reference](./sqlite-databases.md) - Database schemas, client vs server split
- [Sync Protocol Reference](./sync-protocol.md) - CR-SQLite WebSocket sync details
- [Wasabi Storage](./wasabi/) - Bucket configuration, IAM policies, STS setup
- [Supabase Schema Reference](./supabase-schema.md) - PostgreSQL tables, RLS policies, functions
