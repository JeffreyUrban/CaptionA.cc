# Wasabi Storage Integration - Technical Design

## Overview

The video processing system uses Wasabi S3 for large file storage combined with Supabase PostgreSQL for metadata and search indexing. This hybrid architecture optimizes storage costs while maintaining fast query performance for video catalog operations.

## Architecture

### Storage Tiers

**Wasabi S3 (Large Files)**
- Video files
- Split SQLite databases
- Cropped frame chunks (WebM/VP9)

**Supabase PostgreSQL (Metadata)**
- Video catalog
- Processing status
- Cross-video search index
- User management and tenant data

**Local Filesystem (Temporary)**
- Upload staging
- Processing workspace
- Ephemeral state databases

### Storage Structure

Wasabi S3 bucket structure:
```
{bucket}/{tenant_id}/{video_id}/
├── video.mp4                    # Original video file
├── video.db                     # Full frames (0.1Hz) as JPEG BLOBs
├── fullOCR.db                   # OCR detection results
├── layout.db                    # Layout annotations
├── captions.db                  # Caption boundaries and text
├── cropped_frames_v1/           # Versioned cropped framesets (hierarchical modulo-based)
│   ├── modulo_32/               # Coarsest level - every 32nd frame (loads first)
│   │   ├── chunk_0000.webm      # 32 frames: [0, 32, 64, ..., 992]
│   │   ├── chunk_0001.webm      # 32 frames: [1024, 1056, ...]
│   │   └── ...
│   ├── modulo_16/               # Every 16th frame
│   │   ├── chunk_0000.webm      # 32 frames at modulo 16 spacing
│   │   └── ...
│   ├── modulo_8/                # Every 8th frame
│   ├── modulo_4/                # Every 4th frame
│   ├── modulo_2/                # Every 2nd frame
│   └── modulo_1/                # Finest level - every frame (loads last)
│       ├── chunk_0000.webm      # 32 consecutive frames: [0-31]
│       ├── chunk_0001.webm      # 32 consecutive frames: [32-63]
│       └── ...
├── cropped_frames_v2/           # Newer version (when layout changes)
│   ├── modulo_32/
│   └── ...
└── ...
```

**Hierarchical Modulo-Based Chunking:**
- Each chunk contains exactly **32 frames** at the specified modulo spacing
- **Progressive loading**: Coarse to fine (modulo 32 → 16 → 8 → 4 → 2 → 1)
- **Modulo 32**: Quick overview (every 32nd frame)
- **Modulo 1**: Full detail (every frame)
- Browser loads chunks progressively based on viewport position and zoom level

**Versioned Cropped Frames:**
- Multiple versions can exist for ML training reproducibility
- Only one version is "active" at a time for annotation workflows
- Previous versions are archived when a new version is generated
- Versions are tracked in Supabase `cropped_frames_versions` table

## Split Database Architecture

Video data is stored across multiple SQLite databases based on update frequency and data type.

### Database Files

#### video.db (Immutable)
**Tables:**
- `full_frames` - Frame images at 0.1Hz as JPEG BLOBs
- `video_metadata` - Video properties and hashes

**Characteristics:**
- Created once during initial processing
- Never modified after creation
- Size: 15-70 MB per video
- Update frequency: None (immutable)

#### fullOCR.db (Occasional Updates)
**Tables:**
- `full_frame_ocr` - OCR detections, text, confidence, bounding boxes

**Characteristics:**
- Updated when OCR is re-run
- Size: 0.5-5 MB per video
- Update frequency: Rare (algorithm improvements)

#### layout.db (Frequent Updates)
**Tables:**
- `full_frame_box_labels` - User annotations marking caption regions
- `box_classification_model` - Trained Naive Bayes model

**Characteristics:**
- Modified during layout annotation
- Size: 0.05-20 MB per video
- Update frequency: High during annotation sessions

#### captions.db (Frequent Updates)
**Tables:**
- `captions` - Caption boundaries and text content

**Characteristics:**
- Modified during caption annotation
- Size: 0.1-2 MB per video
- Update frequency: High during annotation sessions

#### state.db (Local Only - Not Uploaded)
**Tables:**
- `processing_status` - Workflow state tracking
- `video_preferences` - UI preferences
- `duplicate_resolution` - Temporary conflict data
- `database_metadata` - Schema version info

**Characteristics:**
- Local-only, never uploaded to Wasabi
- Ephemeral, user-specific state
- Size: <100 KB
- Excluded from version control

### Cropped Frame Chunks

Cropped frames are stored as WebM video chunks using VP9 codec rather than individual images or database BLOBs.

**Format:** WebM container with VP9 video codec
**Naming:** `chunk_0000.webm`, `chunk_0001.webm`, `chunk_NNNN.webm`
**Storage:** `{tenant_id}/{video_id}/cropped_frames/chunk_*.webm`

**Advantages:**
- 50-70% smaller than JPEG BLOBs
- Browser-native playback without decoding
- Streaming-friendly (download chunks on demand)
- Efficient compression for sequential frames

## Upload and Processing Flow

### Upload API (`apps/captionacc-web/app/routes/api.upload.$.tsx`)

**Responsibilities:**
1. Receive TUS resumable uploads
2. Store video file to local temporary directory
3. Generate video UUID and storage path
4. Queue Prefect workflow when upload completes

**What it does NOT do:**
- Create any databases
- Track processing status in local storage
- Perform duplicate detection
- Upload to Wasabi (delegated to Prefect)

### Processing Workflow (`upload_and_process_video_flow`)

**Flow Location:** `services/orchestrator/flows/upload_and_process_video.py`

**Steps:**
1. Upload video file to Wasabi
2. Extract full frames (0.1Hz) → create video.db
3. Upload video.db to Wasabi
4. Run OCR on frames → create fullOCR.db
5. Upload fullOCR.db to Wasabi
6. Create Supabase catalog entry
7. Index OCR content for cross-video search
8. Update video status to "active"

**Outputs:**
- Video file in Wasabi
- video.db in Wasabi
- fullOCR.db in Wasabi
- Catalog record in Supabase
- Search index entries in Supabase

## Wasabi Client API

**Location:** `services/orchestrator/wasabi_client.py`

### Core Methods

```python
from wasabi_client import get_wasabi_client

client = get_wasabi_client()

# Upload files
client.upload_file(
    local_path="/local/video.mp4",
    storage_key="tenant_id/video_id/video.mp4",
    content_type="video/mp4"
)

# Upload databases
client.upload_file(
    local_path="/local/video.db",
    storage_key="tenant_id/video_id/video.db",
    content_type="application/x-sqlite3"
)

# Download files
client.download_file(
    storage_key="tenant_id/video_id/video.db",
    local_path="/local/video.db"
)

# Check existence
exists = client.file_exists("tenant_id/video_id/video.mp4")

# List files
files = client.list_files(prefix="tenant_id/video_id/")

# Delete files
client.delete_file("tenant_id/video_id/old_file.mp4")
client.delete_prefix("tenant_id/video_id/")  # Delete entire folder
```

### Storage Key Helpers

```python
# Standard file
key = WasabiClient.build_storage_key(
    tenant_id="00000000-0000-0000-0000-000000000001",
    video_id="a4f2b8c3-1234-5678-90ab-cdef12345678",
    filename="video.mp4"
)
# Returns: "00000000-0000-0000-0000-000000000001/a4f2b8c3-.../video.mp4"

# Versioned hierarchical modulo-based chunks
key = WasabiClient.build_chunk_storage_key(
    tenant_id="00000000-0000-0000-0000-000000000001",
    video_id="a4f2b8c3-1234-5678-90ab-cdef12345678",
    chunk_type="cropped_frames",
    chunk_index=0,
    version=1,
    modulo=32  # Hierarchical level: 32, 16, 8, 4, 2, or 1
)
# Returns: "00000000-.../cropped_frames_v1/modulo_32/chunk_0000.webm"

# Storage prefix for all chunks of a version
prefix = WasabiClient.build_chunk_prefix(
    tenant_id="00000000-0000-0000-0000-000000000001",
    video_id="a4f2b8c3-1234-5678-90ab-cdef12345678",
    chunk_type="cropped_frames",
    version=1
)
# Returns: "00000000-.../cropped_frames_v1/" (all modulo levels)
```

## Supabase Integration

### Videos Table Schema

```sql
CREATE TABLE videos (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,  -- Wasabi: {tenant}/{video}/video.mp4
  size_bytes BIGINT,
  status TEXT,  -- uploading, processing, active, failed, archived
  prefect_flow_run_id TEXT,
  uploaded_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Storage Key Patterns

- **Video**: `{tenant_id}/{video_id}/video.mp4`
- **video.db**: `{tenant_id}/{video_id}/video.db`
- **fullOCR.db**: `{tenant_id}/{video_id}/fullOCR.db`
- **layout.db**: `{tenant_id}/{video_id}/layout.db`
- **captions.db**: `{tenant_id}/{video_id}/captions.db`
- **Versioned Hierarchical Chunks**: `{tenant_id}/{video_id}/cropped_frames_v{version}/modulo_{M}/chunk_NNNN.webm`

### Repository Methods

```python
from supabase_client import VideoRepository

video_repo = VideoRepository()

# Update video status
video_repo.update_video_status(
    video_id="a4f2b8c3-...",
    status="active",
    prefect_flow_run_id="flow-run-id"
)

# Update database storage key
video_repo.update_annotations_db_key(
    video_id="a4f2b8c3-...",
    annotations_db_key="tenant/video/fullOCR.db"
)
```

### Search Indexing

OCR text from `fullOCR.db` is indexed in the `video_search_index` table for cross-video full-text search.

```python
from supabase_client import SearchIndexRepository

search_repo = SearchIndexRepository()
search_repo.upsert_frame_text(
    video_id="a4f2b8c3-...",
    frame_index=100,
    ocr_text="Detected text content"
)
```

## Prefect Flow Integration

### Queue from TypeScript

```typescript
import { queueUploadAndProcessing } from '~/services/prefect'

const result = await queueUploadAndProcessing({
  videoPath: '/local/data/abc123.../video.mp4',
  videoId: 'a4f2b8c3-1234-5678-90ab-cdef12345678',
  filename: 'my_video.mp4',
  fileSize: 52428800,  // bytes
  tenantId: '00000000-0000-0000-0000-000000000001',
  frameRate: 0.1,  // Hz (optional, defaults to 0.1)
  uploadedByUserId: 'user-uuid'  // optional
})

console.log(`Queued: ${result.flowRunId}`)
```

### Queue from Python

```python
from queue_flow import queue_upload_and_process

queue_upload_and_process(
    video_path='/local/data/abc123.../video.mp4',
    video_id='a4f2b8c3-1234-5678-90ab-cdef12345678',
    filename='my_video.mp4',
    file_size=52428800,
    tenant_id='00000000-0000-0000-0000-000000000001',
    frame_rate=0.1,
    uploaded_by_user_id='user-uuid'
)
```

## Configuration

### Environment Variables

Required in `.env`:

```bash
# Wasabi S3 Storage
WASABI_ACCESS_KEY=...
WASABI_SECRET_KEY=...
WASABI_BUCKET=caption-acc-prod
WASABI_REGION=us-east-1

# Supabase
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_KEY=...

# Default Tenant (development only)
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
```

### Boto3 Configuration

The Wasabi client is configured to use Wasabi's S3-compatible endpoint:

```python
s3_client = boto3.client(
    "s3",
    endpoint_url=f"https://s3.{region}.wasabisys.com",
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    config=Config(signature_version="s3v4")
)
```

## Multi-Tenant Isolation

### Path-Based Isolation

All Wasabi storage keys include `tenant_id` as the root prefix, ensuring complete isolation between tenants at the storage level.

### Supabase RLS

Row-level security policies enforce that users can only access videos belonging to their tenant:

```sql
CREATE POLICY "Users can view tenant videos"
  ON videos FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );
```

## Cropped Frames WebM Chunking Workflow

**Flow:** `crop-frames-to-webm` (`crop_frames_to_webm_flow`)

This workflow generates versioned cropped framesets as VP9/WebM chunks for efficient streaming during caption annotation.

### Workflow Steps

1. **Download Assets from Wasabi**
   - Download video file
   - Download layout.db (contains crop bounds and layout model)
   - Compute SHA-256 hash of layout.db for version tracking

2. **Create Version Record**
   - Get next version number from Supabase
   - Create `cropped_frames_versions` record with status='processing'
   - Store metadata: crop bounds, layout.db hash, frame rate

3. **Extract Cropped Frames**
   - Use `crop_frames` pipeline to extract frames at 10Hz
   - Apply crop bounds from layout annotations
   - Write frames to temporary directory as JPEG

4. **Encode as VP9/WebM Chunks (Hierarchical Modulo Levels)**
   - Generate chunks for each modulo level (32, 16, 8, 4, 2, 1)
   - Each chunk contains exactly 32 frames at modulo spacing
   - Encode using FFmpeg with VP9 codec (CRF 23, 500k bitrate)
   - Result: 50-70% smaller than JPEG BLOBs
   - Enables progressive loading from coarse to fine detail

5. **Upload to Wasabi**
   - Upload chunks organized by modulo level
   - Storage pattern: `{tenant_id}/{video_id}/cropped_frames_v{version}/modulo_{M}/chunk_{NNNN}.webm`
   - Coarsest levels uploaded first for faster initial loading

6. **Activate Version**
   - Update version record with chunk count, frame count, total size
   - Call `activate_cropped_frames_version()` database function
   - Archives previous active version
   - Sets new version to status='active'
   - Updates `videos.current_cropped_frames_version`

### Versioning Strategy

**Why Versioning?**
- **ML Training Reproducibility**: Keep historical framesets used for model training
- **Layout Iteration**: Generate new framesets when crop bounds change
- **A/B Testing**: Compare different crop strategies

**Version Lifecycle:**
- **processing**: Version is being generated
- **active**: Current version used for annotation (only one active per video)
- **archived**: Previous version retained for historical reference
- **failed**: Generation failed

**App Behavior:**
- Annotation workflows always use the active version
- While processing a new version, annotation workflows are disabled
- When new version activates, annotation workflows resume with new frameset

### Queue from TypeScript

```typescript
import { queueCropFramesToWebm } from '~/services/prefect'

const result = await queueCropFramesToWebm({
  videoId: 'a4f2b8c3-1234-5678-90ab-cdef12345678',
  cropBounds: { left: 100, top: 200, right: 700, bottom: 250 },
  tenantId: '00000000-0000-0000-0000-000000000001',  // optional
  frameRate: 10.0,  // optional, defaults to 10.0
  createdByUserId: 'user-uuid'  // optional
})

console.log(`Queued: ${result.flowRunId}`)
```

### Queue from Python

```python
from queue_flow import queue_crop_frames_to_webm

queue_crop_frames_to_webm(
    video_id='a4f2b8c3-1234-5678-90ab-cdef12345678',
    crop_bounds='{"left":100,"top":200,"right":700,"bottom":250}',
    tenant_id='00000000-0000-0000-0000-000000000001',
    frame_rate=10.0,
    created_by_user_id='user-uuid'
)
```

### Supabase Schema

```sql
-- Track cropped frame versions
CREATE TABLE cropped_frames_versions (
  id UUID PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  tenant_id UUID REFERENCES tenants(id),
  version INTEGER NOT NULL,
  storage_prefix TEXT NOT NULL,
  crop_bounds JSONB,
  frame_rate REAL DEFAULT 10.0,
  chunk_count INTEGER,
  total_frames INTEGER,
  total_size_bytes BIGINT,
  status TEXT CHECK (status IN ('processing', 'active', 'archived', 'failed')),
  layout_db_storage_key TEXT,
  layout_db_hash TEXT,
  UNIQUE(video_id, version)
);

-- Track current active version
ALTER TABLE videos
ADD COLUMN current_cropped_frames_version INTEGER;
```

## Layout Annotation Workflow

**Flows:** `download-for-layout-annotation` and `upload-layout-db`

This workflow handles the bidirectional synchronization of layout.db with Wasabi for caption layout annotation.

### Download Flow (`download_for_layout_annotation_flow`)

Downloads the necessary files for layout annotation from Wasabi to a local directory.

**Workflow Steps:**

1. **Download video.db**
   - Contains full frames (0.1Hz) as JPEG BLOBs
   - Required for annotation UI to display frames
   - Immutable - never changes after initial processing

2. **Download fullOCR.db**
   - Contains OCR detection results with bounding boxes
   - Provides suggested caption regions for user validation
   - Helps accelerate layout annotation process

3. **Download layout.db (if exists)**
   - Contains existing layout annotations
   - Allows continuing previous annotation sessions
   - If doesn't exist, user starts fresh annotations

**Queue from TypeScript:**

```typescript
import { queueDownloadForLayoutAnnotation } from '~/services/prefect'

const result = await queueDownloadForLayoutAnnotation({
  videoId: 'a4f2b8c3-1234-5678-90ab-cdef12345678',
  outputDir: '/local/annotation_workspace/video_abc123/',
  tenantId: '00000000-0000-0000-0000-000000000001'  // optional
})

console.log(`Download queued: ${result.flowRunId}`)
```

**Queue from Python:**

```python
from queue_flow import queue_download_for_layout_annotation

queue_download_for_layout_annotation(
    video_id='a4f2b8c3-1234-5678-90ab-cdef12345678',
    output_dir='/local/annotation_workspace/video_abc123/',
    tenant_id='00000000-0000-0000-0000-000000000001'
)
```

**Output:**

```python
{
  'video_id': 'a4f2b8c3-1234-5678-90ab-cdef12345678',
  'status': 'completed',
  'video_db_path': '/local/annotation_workspace/video_abc123/video.db',
  'fullOCR_db_path': '/local/annotation_workspace/video_abc123/fullOCR.db',
  'layout_db_path': '/local/annotation_workspace/video_abc123/layout.db',  # or None
  'layout_exists': True  # or False
}
```

### Upload Flow (`upload_layout_db_flow`)

Uploads the annotated layout.db to Wasabi after user completes layout annotations.

**Workflow Steps:**

1. **Upload layout.db to Wasabi**
   - Storage key: `{tenant_id}/{video_id}/layout.db`
   - Overwrites previous version
   - Contains user annotations from layout annotation session

2. **Detect Crop Bounds Changes**
   - Compares crop bounds in uploaded layout.db with active cropped frames version
   - Checks if caption layout regions have changed significantly
   - Determines if new cropped frameset needs to be generated

3. **Trigger Cropped Frames Regeneration (optional)**
   - If `trigger_crop_regen=True` and bounds changed:
     - Automatically queues `crop-frames-to-webm` flow
     - Generates new versioned frameset with updated crop bounds
     - Annotation workflows resume when new version is active

**Queue from TypeScript:**

```typescript
import { queueUploadLayoutDb } from '~/services/prefect'

const result = await queueUploadLayoutDb({
  videoId: 'a4f2b8c3-1234-5678-90ab-cdef12345678',
  layoutDbPath: '/local/annotation_workspace/video_abc123/layout.db',
  tenantId: '00000000-0000-0000-0000-000000000001',  // optional
  triggerCropRegen: true  // optional, defaults to true
})

console.log(`Upload queued: ${result.flowRunId}`)
```

**Queue from Python:**

```python
from queue_flow import queue_upload_layout_db

queue_upload_layout_db(
    video_id='a4f2b8c3-1234-5678-90ab-cdef12345678',
    layout_db_path='/local/annotation_workspace/video_abc123/layout.db',
    tenant_id='00000000-0000-0000-0000-000000000001',
    trigger_crop_regen=True
)
```

**Output:**

```python
{
  'video_id': 'a4f2b8c3-1234-5678-90ab-cdef12345678',
  'storage_key': '00000000-.../a4f2b8c3-.../layout.db',
  'status': 'completed',
  'bounds_changed': True,  # or False
  'crop_regen_triggered': True  # or False
}
```

### Layout.db Schema

**Tables:**

- **full_frame_box_labels**: User annotations marking caption regions
  - Bounding boxes for caption areas on full frames
  - Classification labels (caption vs. non-caption)
  - User corrections to OCR-detected regions

- **box_classification_model**: Trained Naive Bayes model
  - Serialized sklearn model
  - Predicts caption regions on new frames
  - Updated as user provides more annotations

### Crop Bounds Detection

The workflow extracts crop bounds from layout.db annotations and compares them with the active cropped frames version:

- If no active version exists → always regenerate
- If bounds changed significantly → trigger regeneration (if enabled)
- If bounds unchanged → no regeneration needed

**Note:** Current implementation has placeholder logic for crop bounds extraction from `full_frame_box_labels` table. This will be fully implemented when the crop bounds calculation algorithm is finalized.

### Integration with Cropped Frames

When crop bounds change:
1. Upload flow detects the change
2. Queues new `crop-frames-to-webm` flow
3. New version generated with updated bounds
4. Previous version archived (retained for ML training)
5. App switches to new active version
6. Caption annotation workflows resume

## Future Workflows

These workflows are designed but not yet implemented:

### Caption Annotation
1. Download captions.db from Wasabi (if exists)
2. Stream active version WebM chunks on-demand
3. User annotates caption boundaries and text
4. Update captions.db locally
5. Upload captions.db to Wasabi

## Performance Characteristics

### Storage Efficiency

- **VP9 chunks**: 50-70% smaller than equivalent JPEG BLOBs
- **Split databases**: Only download/upload changed databases
- **Streaming**: Fetch chunks on-demand during annotation

### Network Optimization

- **Parallel uploads**: Video and databases uploaded concurrently
- **Resumable uploads**: TUS protocol for large video files
- **Lazy loading**: Only download databases when needed for annotation

### DVC Integration

Split databases enable efficient version control:
- Small annotation changes only version the changed database
- Immutable databases (video.db) uploaded once, never re-versioned
- 80-95% reduction in DVC storage compared to monolithic approach

## Error Handling

### Upload Failures

If Wasabi upload fails during the Prefect flow:
1. Flow retries 3 times with exponential backoff
2. Video status set to "failed" in Supabase
3. Local files retained for manual recovery
4. Webhook sent to web app with error details

### Download Failures

If database download fails during annotation:
1. User sees error message
2. Retry mechanism available
3. Local cache used if available
4. Fallback to read-only mode

### Corrupt Databases

If database corruption detected:
1. Integrity check on download
2. Re-download from Wasabi
3. If still corrupt, mark as requiring reprocessing
4. OCR/extraction can be re-run to recreate

## Monitoring and Debugging

### Logging

**Upload API:**
```
[tus] Created upload: {uploadId} (video ID: {videoId})
[tus] Upload complete: {finalVideoPath}
[Prefect] Queuing upload and processing workflow...
[Prefect] ✅ Successfully queued: {flowRunId}
```

**Prefect Flow:**
```
[Wasabi] Uploading video: {filename}
[Wasabi] Video uploaded: {storage_key}
[video.db] Extracting frames from {video_path} at 0.1Hz
[Wasabi] Uploading database: video.db
[Supabase] Creating video entry: {video_id}
[Supabase] Status updated: active
```

### Metrics

Track these metrics for operational health:
- Upload success rate (TUS)
- Wasabi upload/download latency
- Database size distribution
- Flow execution time
- Failed flow rate

### Debugging Commands

```python
# Check if file exists in Wasabi
client = get_wasabi_client()
exists = client.file_exists("tenant_id/video_id/video.mp4")

# List all files for a video
files = client.list_files(prefix="tenant_id/video_id/")
for f in files:
    print(f)

# Get file size
size = client.get_file_size("tenant_id/video_id/video.db")
print(f"Size: {size / 1024 / 1024:.2f} MB")
```

## Security Considerations

### Credentials Management

- Wasabi credentials stored in environment variables
- Never committed to git
- Service-level credentials, not per-user
- Rotate periodically

### Access Control

- Wasabi bucket not publicly accessible
- All access through authenticated API
- Supabase RLS enforces tenant boundaries
- Upload API validates user authentication (when implemented)

### Data Integrity

- SHA-256 hashes computed for video files
- SQLite database integrity checks on download
- Checksums verified during upload/download
- Atomic operations to prevent partial writes

## Related Documentation

- **Architecture Overview**: `services/orchestrator/WASABI_ARCHITECTURE.md`
- **Split Database Design**: `data-pipelines/docs/database-split-architecture.md`
- **Supabase Setup**: `supabase/docs/SUPABASE_SETUP.md`
- **Frames Database**: `packages/frames_db/README.md`
