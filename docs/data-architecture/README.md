# CaptionA.cc Data Architecture

This document describes the data architecture for CaptionA.cc, covering the three primary storage systems and how data flows between them.

## Overview

CaptionA.cc uses a hybrid storage architecture optimized for different workloads:

| Storage System | Purpose | Data Types |
|----------------|---------|------------|
| **Supabase (PostgreSQL)** | Metadata catalog, multi-tenant access control, search | Video records, user profiles, access tiers, usage metrics |
| **Wasabi S3** | Cost-effective object storage for large files | Videos, SQLite databases, WebM frame chunks |
| **SQLite Databases** | Per-video structured data, stored in Wasabi | Frames, OCR results, layout annotations, captions |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Data Architecture                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐    │
│   │    Supabase     │      │    Wasabi S3    │      │  Local Proc.    │    │
│   │   (PostgreSQL)  │      │                 │      │                 │    │
│   ├─────────────────┤      ├─────────────────┤      ├─────────────────┤    │
│   │ • Video catalog │◄────►│ • video.mp4     │◄────►│ • Processing    │    │
│   │ • User profiles │      │ • video.db      │      │   workspace     │    │
│   │ • Access tiers  │      │ • fullOCR.db    │      │ • Temp files    │    │
│   │ • Usage metrics │      │ • layout.db     │      │                 │    │
│   │ • Search index  │      │ • captions.db   │      │                 │    │
│   │ • Audit logs    │      │ • chunks/*.webm │      │                 │    │
│   └─────────────────┘      └─────────────────┘      └─────────────────┘    │
│                                                                             │
│   Queryable metadata        File storage             Temporary processing   │
│   Multi-tenant RLS          Cost-effective           Hash-bucketed dirs     │
│                             Free egress                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Storage Systems

### 1. Supabase (PostgreSQL)

Supabase serves as the **metadata layer** and **access control system**. It stores:

- **Video catalog**: Video records with storage references pointing to Wasabi
- **User management**: Profiles, tenant membership, access tiers
- **Search index**: Full-text search across OCR text and captions
- **Processing state**: Inference job queue, cropped frames versions
- **Audit logging**: Security events, usage metrics

Multi-tenant isolation is enforced via Row-Level Security (RLS) policies.

See: [Supabase Schema Reference](./supabase-schema.md)

### 2. Wasabi S3 Storage

Wasabi provides **cost-effective object storage** with free egress bandwidth. It stores:

- **Original videos**: Source video files (video.mp4)
- **SQLite databases**: Per-video databases for frames, OCR, layout, captions
- **Cropped frame chunks**: VP9-encoded WebM files for progressive loading

Bucket: `caption-acc-prod` (us-east-1)

See: [Wasabi Storage Reference](./wasabi-storage.md)

### 3. SQLite Databases (Per-Video)

Each video has a set of SQLite databases stored in Wasabi, using a **split architecture** optimized for update frequency:

| Database | Update Frequency | Content | Typical Size |
|----------|------------------|---------|--------------|
| `video.db` | Once or Rarely   | Full-resolution frames (0.1Hz, JPEG blobs) | 15-70 MB |
| `fullOCR.db` | Occasional       | OCR detection results with bounding boxes | 0.5-5 MB |
| `layout.db` | Frequent         | Layout annotations, crop bounds, trained model | 0.05-20 MB |
| `captions.db` | Frequent         | Caption boundaries, text, metadata | 0.1-2 MB |

See: [SQLite Database Reference](./sqlite-databases.md)

## Data Flow

### Video Upload Flow

```
1. User uploads video via TUS resumable upload
2. Backend creates video record in Supabase (status: 'uploading')
3. Prefect flow: upload_and_process_video
   a. Upload video to Wasabi
   b. Extract full frames → video.db → upload to Wasabi
   c. Run OCR → fullOCR.db → upload to Wasabi
4. Video status set to 'active'
```

### Layout Annotation Flow

```
1. Download from Wasabi: video.db + fullOCR.db (+ layout.db if exists)
2. User annotates caption region in browser
3. Create/update layout.db locally on server
4. Upload layout.db to Wasabi
```

### Cropped Frames Flow

```
1. Prefect flow: crop_frames_to_webm
2. Download video + layout.db from Wasabi
3. Extract cropped frames at 10Hz using layout bounds
4. Encode as VP9/WebM chunks (hierarchical modulo levels)
5. Upload chunks to Wasabi: cropped_frames_v{version}/modulo_{M}/chunk_NNNN.webm
6. Create cropped_frames_versions record in Supabase
7. Activate new version (archives previous)
```

### Caption Annotation Flow

```
1. Download captions.db from Wasabi (if exists)
2. Browser streams cropped frame chunks via presigned URLs
3. User annotates caption boundaries and text
4. Upload captions.db to Wasabi
```

## Storage Paths

### Wasabi Path Pattern

```
caption-acc-prod/
└── {tenant_id}/{video_id}/
    ├── video.mp4                    # Original video
    ├── video.db                     # Full frames database
    ├── fullOCR.db                   # OCR results database
    ├── layout.db                    # Layout annotations database
    ├── captions.db                  # Captions database
    └── cropped_frames_v{version}/   # Versioned cropped frames
        ├── modulo_16/               # Every 16th frame (coarsest)
        │   ├── chunk_0000000000.webm
        │   └── ...
        ├── modulo_4/                # Every 4th frame (except modulo 16 frames)
        └── modulo_1/                # Every frame (except modulo 16 or 4 frames, finest)
```

### Local Processing Path Pattern

(files present when needed)

```
local/processing/
└── {first_2_chars_of_uuid}/{full_uuid}/
    ├── video.db
    ├── fullOCR.db
    ├── layout.db
    └── captions.db
```

## Related Documentation

- [Wasabi Storage Reference](./wasabi-storage.md) - Bucket configuration, IAM policies, presigned URLs
- [SQLite Database Reference](./sqlite-databases.md) - Database schemas, tables, indexes
- [Supabase Schema Reference](./supabase-schema.md) - PostgreSQL tables, RLS policies, functions
