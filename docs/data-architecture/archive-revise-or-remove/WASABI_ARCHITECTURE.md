# Wasabi Storage Architecture

## Overview

CaptionA.cc uses a hybrid storage architecture:
- **Wasabi S3**: Large files (videos, frames, databases)
- **Supabase PostgreSQL**: Catalog, metadata, search index, user management

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
!__local/data/_has_been_deprecated__!/{hash}/{video_id}/
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

### Cropped frames

Cropped frames stored as WebM chunks (~50-200 MB total, streamed on demand)

## Benefits of This Architecture

1. **Storage Efficiency**:
   - VP9 chunks are 50-70% smaller than JPEG BLOBs
   - Only download what you need

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
