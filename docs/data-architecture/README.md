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
│  │ • Sync state │    │                                 │    │ server/:     │  │
│  │ • Search     │    │  sync/ (presigned URLs):        │    │ • ocr-server │  │
│  │   index      │    │  • layout.db.gz (CR-SQLite)     │    │   .db        │  │
│  │              │    │  • captions.db.gz (CR-SQLite)   │    │ • layout-    │  │
│  └──────────────┘    └─────────────────────────────────┘    │   server.db  │  │
│                                                              └──────────────┘  │
│  Metadata & Locks      File Storage (Free Egress)          Internal Processing │
│  Multi-tenant RLS      Path-based access control            Proprietary ML     │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Storage Path Organization

Wasabi paths are organized by **access level** for security:

```
{tenant_id}/videos/{video_id}/
├── client/                    # Tenant-accessible via STS credentials
│   ├── video.mp4              # Original video
│   ├── full_frames/           # Frame images (layout page)
│   └── cropped_frames_v*/     # WebM chunks (caption editor)
│
├── sync/                      # Accessed via presigned URLs only
│   ├── layout.db.gz           # CR-SQLite synced
│   └── captions.db.gz         # CR-SQLite synced
│
└── server/                    # Server-only (never client-accessible)
    ├── ocr-server.db          # Full OCR results
    └── layout-server.db       # ML model, analysis params
```

**Security principle:** Path structure enforces access boundaries:
- `client/*` - Tenant gets STS credentials for read-only access to all their videos
- `sync/*` - Individual presigned URLs (15 min expiry) for database downloads
- `server/*` - Never included in any client credentials

See: [Wasabi Storage Reference](./wasabi-storage.md)

## Client vs Server Data

Databases are split by **visibility**:

| Database | Location | Access | Sync | Purpose |
|----------|----------|--------|------|---------|
| `layout.db` | `sync/` | Presigned URL | CR-SQLite (bidirectional) | Boxes, annotations, bounds |
| `captions.db` | `sync/` | Presigned URL | CR-SQLite (client→server) | Caption boundaries, text |
| `ocr-server.db` | `server/` | None | None | Full OCR results |
| `layout-server.db` | `server/` | None | None | ML model, analysis params |

**Key principle:** Client downloads databases via presigned URLs through the sync API. Media assets (frames, chunks) accessed via STS credentials for high-volume, low-latency access.

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

- **Original videos**: `client/video.mp4`
- **Full-resolution frames**: `client/full_frames/*.jpg` (0.1Hz)
- **Cropped frame chunks**: `client/cropped_frames_v*/modulo_*/*.webm`
- **Sync databases**: `sync/layout.db.gz`, `sync/captions.db.gz` (gzip compressed)
- **Server databases**: `server/ocr-server.db`, `server/layout-server.db`

Bucket: `caption-acc-prod` (us-east-1)

See: [Wasabi Storage Reference](./wasabi-storage.md)

### 3. SQLite Databases (Per-Video)

Each video has SQLite databases stored in Wasabi, split by visibility:

**Client-Facing (synced via CR-SQLite):**

| Database | Sync Direction | Content |
|----------|----------------|---------|
| `layout.db` | Bidirectional | Box positions, user annotations, server predictions, bounds |
| `captions.db` | Client → Server | Caption boundaries, text, status |

**Server-Only (internal):**

| Database | Content |
|----------|---------|
| `ocr-server.db` | Full OCR results from Google Vision API |
| `layout-server.db` | Trained ML model, analysis parameters |

See: [SQLite Database Reference](./sqlite-databases.md)

## Data Flow

### Video Upload Flow

```
1. Client calls Edge Function for presigned upload URL
2. Client uploads video directly to Wasabi (client/video.mp4)
3. Backend creates video record in Supabase (status: 'uploading')
4. Prefect flow: upload_and_process_video
   a. Extract full frames → client/full_frames/*.jpg
   b. Run OCR → server/ocr-server.db
   c. Initialize sync/layout.db.gz with box data from OCR
5. Video status set to 'active'
```

### Layout Annotation Flow (CR-SQLite Sync)

```
1. Client requests presigned URL for sync/layout.db.gz
2. Client downloads directly from Wasabi (no server load)
3. Client loads into wa-sqlite + CR-SQLite extension
4. User annotates boxes (in/out/clear) - instant local edits
5. Client syncs changes via WebSocket → Server applies → uploads to Wasabi
6. Server runs ML predictions → syncs back to client
7. User approves layout → workflow lock transitions
```

### Cropped Frames Flow

```
1. Prefect flow: crop_frames_to_webm
2. Download client/video.mp4 + server/layout-server.db from Wasabi
3. Extract cropped frames at 10Hz using layout bounds
4. Encode as VP9/WebM chunks (hierarchical modulo levels)
5. Upload chunks to Wasabi: client/cropped_frames_v{version}/modulo_{M}/chunk_NNNN.webm
6. Create cropped_frames_versions record in Supabase
7. Activate new version (archives previous)
```

### Caption Annotation Flow (CR-SQLite Sync)

```
1. Client gets STS credentials for tenant (one-time per session)
2. Client requests presigned URL for sync/captions.db.gz
3. Client downloads captions.db directly from Wasabi
4. Client loads into wa-sqlite + CR-SQLite extension
5. Browser streams cropped frame chunks directly from Wasabi using STS credentials
6. User edits caption boundaries and text - instant local edits
7. Client syncs changes via WebSocket → Server validates → uploads to Wasabi
```

## Client Access Methods

| Asset Type | Access Method | Why |
|------------|---------------|-----|
| Frame chunks (`.webm`) | STS credentials | High volume, performance critical |
| Frame images (`.jpg`) | STS credentials | High volume, layout thumbnails |
| Sync databases (`.db.gz`) | Presigned URL | Versioned, needs sync API |
| Original video | Presigned URL | Large file, infrequent |
| Server databases | None | Proprietary, server-only |

### STS Credentials

```
GET /s3-credentials
Authorization: Bearer <jwt>

Response:
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
  "prefix": "{tenant_id}/videos/*/client/"
}
```

Client uses credentials with S3 SDK for direct Wasabi access. No API round-trip for media.

## CR-SQLite Sync Protocol

Client and server use CR-SQLite for change tracking and synchronization:

```
Client                                    Server
──────                                    ──────
Download .db from Wasabi ◄─────────────── Presigned URL
Load wa-sqlite + CR-SQLite
Make local edits (instant)

Query crsql_changes table
Send changes via WebSocket ──────────────► Validate & apply
                           ◄────────────── Ack + version
                                          Upload to Wasabi
```

**Workflow Locks:** Supabase `video_database_state` table prevents concurrent client/server writes. Client notified via WebSocket when lock state changes.

See: [Sync Protocol Reference](./sync-protocol.md)

## Storage Paths

### Wasabi Path Pattern

```
caption-acc-prod/
└── {tenant_id}/videos/{video_id}/
    │
    ├── client/                          # STS credentials (tenant read-only)
    │   ├── video.mp4                    # Original video
    │   │
    │   ├── full_frames/                 # Full-resolution frames (0.1Hz)
    │   │   ├── frame_000000.jpg
    │   │   ├── frame_000001.jpg
    │   │   └── ...
    │   │
    │   └── cropped_frames_v{version}/   # Versioned cropped frames
    │       ├── modulo_16/               # Every 16th frame (coarsest)
    │       │   ├── chunk_0000000000.webm
    │       │   └── ...
    │       ├── modulo_4/                # Every 4th frame (medium)
    │       └── modulo_1/                # Every frame (finest)
    │
    ├── sync/                            # Presigned URLs (15 min expiry)
    │   ├── layout.db.gz                 # Boxes, annotations, bounds (CR-SQLite)
    │   └── captions.db.gz               # Captions (CR-SQLite)
    │
    └── server/                          # Server-only (never client-accessible)
        ├── ocr-server.db                # Full OCR results
        └── layout-server.db             # ML model, analysis params
```

### Local Processing Path Pattern

Server-side temporary files during processing:

```
local/processing/
└── {first_2_chars_of_uuid}/{full_uuid}/
    ├── ocr-server.db
    ├── layout-server.db
    ├── layout.db
    └── captions.db
```

## Related Documentation

- [SQLite Database Reference](./sqlite-databases.md) - Database schemas, client vs server split
- [Sync Protocol Reference](./sync-protocol.md) - CR-SQLite WebSocket sync details
- [Wasabi Storage Reference](./wasabi-storage.md) - Bucket configuration, IAM policies, STS setup
- [Supabase Schema Reference](./supabase-schema.md) - PostgreSQL tables, RLS policies, functions
