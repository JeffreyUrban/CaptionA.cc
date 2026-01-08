# Wasabi Storage Architecture

## Overview

CaptionA.cc uses a hybrid storage architecture:
- **Wasabi S3**: Large files (videos, frames, databases)
- **Supabase PostgreSQL**: Catalog, metadata, search index, user management

## Wasabi Storage Structure

```
{tenant_id}/{video_id}/
  ├── video.mp4                    # Original video file
  ├── video.db                     # Full frames (0.1Hz) as JPEG BLOBs
  ├── fullOCR.db                   # OCR detection results
  ├── layout.db                    # Layout annotations
  ├── captions.db                  # Caption boundaries and text
  └── cropped_frames/
      ├── chunk_0000.webm          # Cropped frames 0-N (VP9/WebM)
      ├── chunk_0001.webm          # Cropped frames N+1-2N
      └── ...
```

### Files NOT in Wasabi

- **state.db**: Local-only ephemeral state (UI preferences, processing status)
- **cropping.db**: REPLACED by WebM chunks (legacy database, no longer used)
- **captions.db**: DEPRECATED - replaced by split database architecture

## Split Database Architecture

### DVC-Tracked Databases (uploaded to Wasabi)

#### video.db (Immutable)
- **Tables**: `full_frames`, `video_metadata`
- **Update Pattern**: Set once at ingestion, never modified
- **Size**: ~15-70 MB per video
- **Contains**: Full resolution frames at 0.1Hz as JPEG BLOBs

#### fullOCR.db (Occasional)
- **Tables**: `full_frame_ocr`
- **Update Pattern**: Only when OCR is re-run
- **Size**: ~0.5-5 MB per video
- **Contains**: OCR detection boxes, text, confidence scores

#### layout.db (Frequent)
- **Tables**: `full_frame_box_labels`, `box_classification_model`
- **Update Pattern**: During layout annotation
- **Size**: ~0.05-20 MB per video
- **Contains**: User annotations marking OCR boxes as in/out of caption region

#### captions.db (Frequent)
- **Tables**: `captions`
- **Update Pattern**: During caption annotation
- **Size**: ~0.1-2 MB per video
- **Contains**: Caption boundaries and text content

### Cropped Frame Chunks (WebM/VP9)

Instead of storing cropped frames in a database (cropping.db), frames are stored as **WebM video chunks** using VP9 codec:

- **Format**: WebM container with VP9 video codec
- **Naming**: `chunk_0000.webm`, `chunk_0001.webm`, etc.
- **Benefits**:
  - Efficient compression (VP9 is excellent for this use case)
  - Streaming-friendly (can download chunks on demand)
  - Browser-native playback support
  - Smaller storage footprint than JPEG BLOBs

## Workflows

### 1. Upload & Initial Processing

```
User uploads video
    ↓
Backend receives upload (local disk)
    ↓
Queue Prefect flow: upload-and-process-video
    ↓
[Prefect Flow]
├─ Upload video.mp4 to Wasabi
├─ Create Supabase catalog entry
├─ Extract full frames → video.db
├─ Upload video.db to Wasabi
├─ Run OCR → fullOCR.db
├─ Upload fullOCR.db to Wasabi
├─ Index OCR text in Supabase search
└─ Mark video as "active" in Supabase
```

### 2. Layout Annotation (User-Initiated)

```
User opens video for layout annotation
    ↓
Download from Wasabi:
├─ video.db (full frames)
└─ fullOCR.db (OCR detections)
    ↓
User annotates caption region
    ↓
Update layout.db locally
    ↓
Upload layout.db to Wasabi
```

### 3. Crop Frames Processing (After Layout Approval)

```
User approves layout configuration
    ↓
Queue Prefect flow: crop-video-frames
    ↓
[Prefect Flow]
├─ Download video file from Wasabi
├─ Download layout.db from Wasabi
├─ Extract cropped frames (10Hz)
├─ Encode as WebM chunks (VP9 codec)
└─ Upload chunks to Wasabi
```

### 4. Caption Annotation

```
User opens video for caption annotation
    ↓
Download from Wasabi:
├─ captions.db (existing captions)
└─ cropped_frames/chunk_*.webm (as needed)
    ↓
User annotates caption boundaries and text
    ↓
Update captions.db locally
    ↓
Upload captions.db to Wasabi
```

## Supabase Integration

### Videos Table

```sql
CREATE TABLE videos (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,  -- Wasabi key: {tenant}/{video}/video.mp4
  size_bytes BIGINT,
  status TEXT,  -- uploading, processing, active, failed
  ...
);
```

### Storage Keys

- **Video**: `{tenant_id}/{video_id}/video.mp4`
- **video.db**: `{tenant_id}/{video_id}/video.db`
- **fullOCR.db**: `{tenant_id}/{video_id}/fullOCR.db`
- **layout.db**: `{tenant_id}/{video_id}/layout.db`
- **captions.db**: `{tenant_id}/{video_id}/captions.db`
- **Chunks**: `{tenant_id}/{video_id}/cropped_frames/chunk_0000.webm`

### Search Index

OCR text from `fullOCR.db` is indexed in Supabase `video_search_index` table for cross-video full-text search.

## Environment Variables

```bash
# Wasabi credentials
WASABI_ACCESS_KEY=...
WASABI_SECRET_KEY=...
WASABI_BUCKET=caption-acc-prod
WASABI_REGION=us-east-1

# Supabase
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...

# Tenant (dev/testing only, production uses user's tenant)
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
```

## Migration Notes

### From Monolithic captions.db

Old structure (deprecated):
```
local/data/{hash}/{video_id}/
  └── captions.db  # All data in one file
```

New structure:
```
Wasabi: {tenant_id}/{video_id}/
  ├── video.mp4
  ├── video.db
  ├── fullOCR.db
  ├── layout.db
  ├── captions.db
  └── cropped_frames/
      └── chunk_*.webm
```

### From cropping.db

Old: Cropped frames stored as BLOBs in `cropping.db` (90-420 MB)
New: Cropped frames stored as WebM chunks (~50-200 MB total, streamed on demand)

## Benefits of This Architecture

1. **Storage Efficiency**:
   - VP9 chunks are 50-70% smaller than JPEG BLOBs
   - Only download what you need (no need for full cropping.db)

2. **Bandwidth Optimization**:
   - Stream chunks as needed during annotation
   - Incremental database uploads (only changed databases)

3. **DVC Integration**:
   - Split databases enable efficient version control
   - Only re-version changed databases

4. **Browser-Native Playback**:
   - WebM chunks play directly in browser
   - No need to decode database BLOBs to video

5. **Multi-Tenant Isolation**:
   - Wasabi paths include tenant_id
   - Supabase RLS enforces tenant boundaries
