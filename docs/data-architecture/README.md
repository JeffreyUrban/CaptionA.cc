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
│  │ • Video      │    │  Client-Facing:                 │    │ • ML models  │  │
│  │   catalog    │◄──►│  • layout.db (CR-SQLite sync)   │◄──►│ • OCR        │  │
│  │ • User       │    │  • captions.db (CR-SQLite sync) │    │ • Inference  │  │
│  │   profiles   │    │  • full_frames/*.jpg            │    │              │  │
│  │ • Workflow   │    │  • chunks/*.webm                │    │ Server-Only: │  │
│  │   locks      │    │                                 │    │ • ocr-server │  │
│  │ • Search     │    │  Server-Only:                   │    │   .db        │  │
│  │   index      │    │  • ocr-server.db                │    │ • layout-    │  │
│  │              │    │  • layout-server.db             │    │   server.db  │  │
│  └──────────────┘    └─────────────────────────────────┘    └──────────────┘  │
│                                                                                │
│  Metadata & Locks      File Storage (Free Egress)          Internal Processing │
│  Multi-tenant RLS      Client downloads directly            Proprietary ML     │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Client vs Server Data

Databases are split by **visibility**:

| Database | Visibility | Sync | Purpose |
|----------|------------|------|---------|
| `layout.db` | **Client** | CR-SQLite (bidirectional) | Boxes, annotations, bounds |
| `captions.db` | **Client** | CR-SQLite (client→server) | Caption boundaries, text |
| `ocr-server.db` | Server-only | None | Full OCR results |
| `layout-server.db` | Server-only | None | ML model, analysis params |

**Key principle:** Client downloads databases directly from Wasabi via presigned URLs. Server is only involved for generating URLs and processing sync requests.

See: [SQLite Database Reference](./sqlite-databases.md)

## Storage Systems

### 1. Supabase (PostgreSQL)

Supabase serves as the **metadata layer** and **access control system**. It stores:

- **Video catalog**: Video records with storage references pointing to Wasabi
- **User management**: Profiles, tenant membership, access tiers
- **Workflow locks**: Prevents concurrent client/server edits
- **Search index**: Full-text search across OCR text and captions
- **Processing state**: Inference job queue, cropped frames versions

Multi-tenant isolation is enforced via Row-Level Security (RLS) policies.

See: [Supabase Schema Reference](./supabase-schema.md)

### 2. Wasabi S3 Storage

Wasabi provides **cost-effective object storage** with free egress bandwidth. It stores:

- **Original videos**: Source video files (video.mp4)
- **Full-resolution frames**: Individual JPEG files at 0.1Hz (full_frames/*.jpg)
- **SQLite databases**: Client-facing (layout.db, captions.db) and server-only (ocr-server.db, layout-server.db)
- **Cropped frame chunks**: VP9-encoded WebM files for progressive loading

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
1. User uploads video via TUS resumable upload
2. Backend creates video record in Supabase (status: 'uploading')
3. Prefect flow: upload_and_process_video
   a. Upload video to Wasabi
   b. Extract full frames → full_frames/*.jpg → upload to Wasabi
   c. Run OCR → ocr-server.db → upload to Wasabi
   d. Initialize layout.db with box data from OCR
4. Video status set to 'active'
```

### Layout Annotation Flow (CR-SQLite Sync)

```
1. Client requests presigned URL for layout.db
2. Client downloads layout.db directly from Wasabi (no server load)
3. Client loads into wa-sqlite + CR-SQLite extension
4. User annotates boxes (in/out/clear) - instant local edits
5. Client syncs changes via WebSocket → Server applies → uploads to Wasabi
6. Server runs ML predictions → syncs back to client
7. User approves layout → workflow lock transitions
```

### Cropped Frames Flow

```
1. Prefect flow: crop_frames_to_webm
2. Download video + layout-server.db from Wasabi
3. Extract cropped frames at 10Hz using layout bounds
4. Encode as VP9/WebM chunks (hierarchical modulo levels)
5. Upload chunks to Wasabi: cropped_frames_v{version}/modulo_{M}/chunk_NNNN.webm
6. Create cropped_frames_versions record in Supabase
7. Activate new version (archives previous)
```

### Caption Annotation Flow (CR-SQLite Sync)

```
1. Client requests presigned URL for captions.db
2. Client downloads captions.db directly from Wasabi
3. Client loads into wa-sqlite + CR-SQLite extension
4. Browser streams cropped frame chunks via presigned URLs
5. User edits caption boundaries and text - instant local edits
6. Client syncs changes via WebSocket → Server validates → uploads to Wasabi
7. (Future) Server may push OCR updates back to client
```

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

**Workflow Locks:** Supabase `videos.workflow_lock` column prevents concurrent client/server writes. Client notified via WebSocket when lock state changes.

See: [Sync Protocol Reference](./sync-protocol.md)

## Storage Paths

### Wasabi Path Pattern

```
caption-acc-prod/
└── {tenant_id}/{video_id}/
    ├── video.mp4                    # Original video
    │
    ├── full_frames/                 # Full-resolution frames (0.1Hz)
    │   ├── frame_000000.jpg
    │   ├── frame_000001.jpg
    │   └── ...
    │
    ├── Client-Facing Databases (gzip compressed):
    │   ├── layout.db.gz             # Boxes, annotations, bounds (CR-SQLite)
    │   └── captions.db.gz           # Captions (CR-SQLite)
    │
    ├── Server-Only Databases:
    │   ├── ocr-server.db            # Full OCR results
    │   └── layout-server.db         # ML model, analysis params
    │
    └── cropped_frames_v{version}/   # Versioned cropped frames
        ├── modulo_16/               # Every 16th frame (coarsest)
        │   ├── chunk_0000000000.webm
        │   └── ...
        ├── modulo_4/                # Every 4th frame (medium)
        └── modulo_1/                # Every frame (finest)
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
- [Wasabi Storage Reference](./wasabi-storage.md) - Bucket configuration, IAM policies, presigned URLs
- [Supabase Schema Reference](./supabase-schema.md) - PostgreSQL tables, RLS policies, functions
