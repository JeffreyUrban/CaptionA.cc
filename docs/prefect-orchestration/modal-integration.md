# Modal Integration

Modal provides GPU compute for heavy processing tasks. Prefect orchestrates Modal function calls and handles results.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Prefect ↔ Modal Integration                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Prefect (Fly.io)                        Modal (GPU Cloud)                 │
│   ────────────────                        ─────────────────                 │
│                                                                              │
│   ┌─────────────────┐                     ┌─────────────────┐              │
│   │  Prefect Flow   │                     │  Modal Function │              │
│   │                 │  1. .remote() call  │                 │              │
│   │  @flow          │ ───────────────────►│  @app.function  │              │
│   │  def process(): │                     │  def extract(): │              │
│   │    result =     │                     │    # GPU work   │              │
│   │    modal_fn()   │  2. Return result   │    return {...} │              │
│   │                 │ ◄───────────────────│                 │              │
│   └─────────────────┘                     └─────────────────┘              │
│                                                                              │
│   Modal SDK handles:                      Modal provides:                   │
│   - Authentication                        - GPU instances                   │
│   - Retries                               - Auto-scaling                    │
│   - Timeouts                              - Wasabi access                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Modal Functions

### 1. extract_frames_and_ocr

Extracts frames from video and runs OCR on each frame.

#### Function Signature

```python
@app.function(
    gpu="T4",
    timeout=1800,  # 30 minutes
    retries=0,
    secrets=[modal.Secret.from_name("wasabi"), modal.Secret.from_name("google-vision")]
)
def extract_frames_and_ocr(
    video_key: str,
    tenant_id: str,
    video_id: str,
    frame_rate: float = 0.1
) -> ExtractResult:
    ...
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `video_key` | str | Wasabi S3 key for video file |
| `tenant_id` | str | Tenant UUID for path scoping |
| `video_id` | str | Video UUID |
| `frame_rate` | float | Frames per second to extract (default: 0.1 = 1 per 10s) |

#### Return Value

```python
@dataclass
class ExtractResult:
    frame_count: int          # Number of frames extracted
    duration: float           # Video duration in seconds
    ocr_box_count: int        # Total OCR detections
    full_frames_key: str      # Wasabi path to frames directory
    ocr_db_key: str           # Wasabi path to raw-ocr.db.gz
    layout_db_key: str        # Wasabi path to layout.db.gz
```

#### Wasabi Outputs

| Output | Path | Description |
|--------|------|-------------|
| Frames | `{tenant}/client/videos/{id}/full_frames/frame_{NNNNNN}.jpg` | JPEG frames |
| OCR DB | `{tenant}/server/videos/{id}/raw-ocr.db.gz` | Full OCR results |
| Layout DB | `{tenant}/client/videos/{id}/layout.db.gz` | Initial box data |

#### Processing Steps

1. Download video from Wasabi
2. Extract frames using FFmpeg (GPU-accelerated)
3. Generate thumbnails (resized frames)
4. Run Google Vision OCR on each frame
5. Create raw-ocr.db with full results
6. Create layout.db with box positions
7. Upload all outputs to Wasabi
8. Return result summary

---

### 2. crop_and_infer_caption_frame_extents

Crops frames to crop region, encodes as WebM, and runs caption frame extents inference.

#### Function Signature

```python
@app.function(
    gpu="A10G",
    timeout=3600,  # 60 minutes
    retries=0,
    secrets=[modal.Secret.from_name("wasabi")]
)
def crop_and_infer_caption_frame_extents(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0
) -> CropInferResult:
    ...
```

#### Parameters

| Parameter | Type | Description                       |
|-----------|------|-----------------------------------|
| `video_key` | str | Wasabi S3 key for video file      |
| `tenant_id` | str | Tenant UUID                       |
| `video_id` | str | Video UUID                        |
| `crop_region` | CropRegion | Normalized crop region (0-1)      |
| `frame_rate` | float | Frames per second (default: 10.0) |

```python
@dataclass
class CropRegion:
    crop_left: float    # 0-1
    crop_top: float     # 0-1
    crop_right: float   # 0-1
    crop_bottom: float  # 0-1
```

#### Return Value

```python
@dataclass
class CropInferResult:
    version: int              # Cropped frames version number
    caption_frame_extents_db_key: str     # Wasabi path to caption_frame_extents.db
    cropped_frames_prefix: str  # Wasabi prefix for chunks
```

#### Wasabi Outputs

| Output | Path | Description |
|--------|------|-------------|
| WebM chunks | `{tenant}/client/videos/{id}/cropped_frames_v{N}/modulo_{M}/chunk_{NNNN}.webm` | VP9 video chunks |
| Inference DB | `{tenant}/server/videos/{id}/caption_frame_extents.db` | Raw predictions |

#### Processing Steps

1. Download video from Wasabi
2. Crop and extract frames at 10Hz using FFmpeg
3. Encode frames as VP9 WebM chunks (modulo hierarchy)
4. Generate frame pairs for inference
5. Run caption frame extents inference model on pairs
6. Store predictions in caption_frame_extents.db
7. Upload chunks and DB to Wasabi
8. Return result summary

#### Modulo Hierarchy

Chunks are organized by sampling level for progressive loading:

```
cropped_frames_v1/
├── modulo_16/   # Every 16th frame (coarse preview)
├── modulo_4/    # Every 4th frame (medium detail)
└── modulo_1/    # Every frame (full detail)
```

---

### 3. generate_caption_ocr

Generates a median frame from a range and runs OCR.

#### Function Signature

```python
@app.function(
    gpu="T4",
    timeout=300,  # 5 minutes
    retries=1,
    secrets=[modal.Secret.from_name("wasabi"), modal.Secret.from_name("google-vision")]
)
def generate_caption_ocr(
    chunks_prefix: str,
    start_frame: int,
    end_frame: int
) -> CaptionOcrResult:
    ...
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chunks_prefix` | str | Wasabi prefix for cropped_frames_v{N}/ |
| `start_frame` | int | Start frame index (inclusive) |
| `end_frame` | int | End frame index (exclusive) |

#### Return Value

```python
@dataclass
class CaptionOcrResult:
    ocr_text: str         # Extracted text
    confidence: float     # OCR confidence (0-1)
    frame_count: int      # Frames used in median
```

#### Processing Steps

1. Download relevant WebM chunks from Wasabi
2. Extract frames in range
3. Compute per-pixel median across frames
4. Run Google Vision OCR on median frame
5. Return OCR text result

---

## Prefect Integration

### Calling Modal from Prefect

```python
import modal

# Import Modal stub
modal_app = modal.App.lookup("captionacc-processing")

@flow(name="captionacc-video-initial-processing")
def captionacc_video_initial_processing(video_id: str, tenant_id: str, storage_key: str):
    # Get Modal function handle
    extract_fn = modal_app.functions["extract_frames_and_ocr"]

    # Call Modal function (blocks until complete)
    result = extract_fn.remote(
        video_key=storage_key,
        tenant_id=tenant_id,
        video_id=video_id,
        frame_rate=0.1
    )

    # Use result
    update_video_metadata(
        video_id=video_id,
        frame_count=result.frame_count,
        duration_seconds=result.duration
    )
```

### Error Handling

```python
from modal.exception import TimeoutError as ModalTimeout

@flow(name="captionacc-video-initial-processing")
def captionacc_video_initial_processing(video_id: str, tenant_id: str, storage_key: str):
    try:
        result = extract_fn.remote(...)

    except ModalTimeout:
        # Modal function exceeded timeout
        update_video_status(video_id, status="error", error="Processing timeout")
        raise

    except modal.exception.RemoteError as e:
        # Modal function raised an exception
        update_video_status(video_id, status="error", error=str(e))
        raise

    except Exception as e:
        # Network or other error
        update_video_status(video_id, status="error", error=f"Modal error: {e}")
        raise
```

### Retry Configuration

Modal functions handle retries internally. Prefect should not retry Modal calls:

```python
@task(retries=0)  # No Prefect retries for Modal calls
def call_modal_extract(video_key: str, tenant_id: str, video_id: str):
    return extract_fn.remote(
        video_key=video_key,
        tenant_id=tenant_id,
        video_id=video_id
    )
```

---

## Resource Allocation

### GPU Selection

| Function | GPU | Rationale |
|----------|-----|-----------|
| extract_frames_and_ocr | T4 | FFmpeg decode, sufficient for OCR |
| crop_and_infer_caption_frame_extents | A10G | Inference model needs more VRAM |
| generate_caption_ocr | T4 | Small workload, T4 sufficient |

### Timeouts

| Function | Timeout | Rationale |
|----------|---------|-----------|
| extract_frames_and_ocr | 30 min | Long videos (2+ hours) |
| crop_and_infer_caption_frame_extents | 60 min | Many frames + inference |
| generate_caption_ocr | 5 min | Single frame operation |

### Scaling

Modal auto-scales based on demand:
- Min containers: 0 (scales to zero)
- Max containers: 10 (configurable)
- Scale-up time: ~10-30 seconds (cold start)

---

## Cost Estimation

### Modal Pricing (approximate)

| GPU | Cost/Hour | Typical Use |
|-----|-----------|-------------|
| T4 | ~$0.60 | Frame extraction, OCR |
| A10G | ~$1.10 | Inference |

### Per-Video Estimates

| Operation | Duration | GPU | Cost |
|-----------|----------|-----|------|
| Initial processing (1hr video) | ~5 min | T4 | ~$0.05 |
| Crop + infer (1hr video) | ~15 min | A10G | ~$0.28 |
| Median OCR | ~30 sec | T4 | ~$0.01 |

**Total per video: ~$0.34** (for a 1-hour video)

---

## Secrets Configuration

### Modal Secrets

```bash
# Create Wasabi secret
modal secret create wasabi \
  WASABI_ACCESS_KEY=xxx \
  WASABI_SECRET_KEY=xxx \
  WASABI_BUCKET=caption-acc-prod \
  WASABI_REGION=us-east-1

# Create Google Vision secret
modal secret create google-vision \
  GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
```

### Prefect Secrets

Prefect needs Modal credentials to call functions:

```bash
# Set in Fly.io
fly secrets set MODAL_TOKEN_ID=xxx
fly secrets set MODAL_TOKEN_SECRET=xxx
```

---

## Monitoring

### Modal Dashboard

- Function invocations
- GPU utilization
- Error rates
- Cost tracking

### Prefect Integration

Log Modal call details in Prefect:

```python
from prefect import get_run_logger

@flow
def captionacc_video_initial_processing(...):
    logger = get_run_logger()

    logger.info(f"Calling Modal extract_frames_and_ocr for video {video_id}")
    result = extract_fn.remote(...)
    logger.info(f"Modal complete: {result.frame_count} frames extracted")
```

---

## Testing

### Local Testing

```python
# Test Modal function locally (no GPU)
if __name__ == "__main__":
    with modal.enable_local_mode():
        result = extract_frames_and_ocr(
            video_key="test/video.mp4",
            tenant_id="test-tenant",
            video_id="test-video"
        )
        print(result)
```

### Integration Testing

```python
# Test from Prefect flow
def test_captionacc_video_processing_flow():
    result = captionacc_video_initial_processing(
        video_id="test-video-id",
        tenant_id="test-tenant-id",
        storage_key="test/videos/test.mp4"
    )
    assert result["frame_count"] > 0
```

## Related Documentation

- [README](./README.md) - Architecture overview
- [Flows](./flows.md) - Flow specifications
- [Data Architecture](../data-architecture/README.md) - Storage paths and schemas
