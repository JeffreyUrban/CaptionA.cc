# Modal Integration

Modal provides GPU compute for heavy processing tasks. Prefect orchestrates Modal function calls and handles results.

---

## Integration Architecture

```
Prefect Flow (API Service)         Modal Functions (GPU Cloud)
──────────────────────              ───────────────────────────

@flow                               @app.function(gpu="T4")
def my_flow():                      def extract_frames(...):
    result = modal_fn.remote()  →       # GPU work
    use(result)                 ←       return result
```

**Key Points:**
- Flows call Modal functions via `.remote()` (blocks until complete)
- Modal SDK handles authentication, retries, timeouts
- Results are strongly typed (Python dataclasses)
- Exceptions propagate to flow for handling

---

## Modal Functions

### 1. extract_frames_and_ocr

Extracts frames from video and runs OCR on each frame.

**Configuration:**
- GPU: T4
- Timeout: 30 minutes
- Retries: 0 (flow handles)

**Parameters:**
```python
video_key: str        # Wasabi S3 key
tenant_id: str        # Tenant UUID
video_id: str         # Video UUID
frame_rate: float     # Frames/second (default: 0.1)
```

**Returns:** `ExtractResult`
- `frame_count`, `duration`, `frame_width`, `frame_height`
- `video_codec`, `bitrate`
- `ocr_box_count`, `failed_ocr_count`
- `processing_duration_seconds`
- Wasabi keys: `full_frames_key`, `ocr_db_key`, `layout_db_key`

**Outputs to Wasabi:**
- `{tenant}/client/videos/{id}/full_frames/frame_*.jpg`
- `{tenant}/server/videos/{id}/raw-ocr.db.gz`
- `{tenant}/client/videos/{id}/layout.db.gz`

---

### 2. crop_and_infer_caption_frame_extents

Crops frames to caption region, encodes as WebM, runs inference.

**Configuration:**
- GPU: A10G (needs more VRAM)
- Timeout: 60 minutes
- Retries: 0 (flow handles)

**Parameters:**
```python
video_key: str        # Wasabi S3 key
tenant_id: str        # Tenant UUID
video_id: str         # Video UUID
crop_region: CropRegion  # Normalized coordinates (0-1)
frame_rate: float     # Frames/second (default: 10.0)
```

**Returns:** `CropInferResult`
- `version`, `frame_count`
- `label_counts: dict[str, int]`  # e.g., {"caption_start": 45, "no_change": 1200}
- `processing_duration_seconds`
- Wasabi keys: `caption_frame_extents_db_key`, `cropped_frames_prefix`

**Outputs to Wasabi:**
- `{tenant}/client/videos/{id}/cropped_frames_v{N}/modulo_{M}/chunk_*.webm`
- `{tenant}/server/videos/{id}/caption_frame_extents.db`

**Modulo Hierarchy:** Progressive loading
- `modulo_16/` - Every 16th frame (coarse preview)
- `modulo_4/` - Every 4th frame (medium detail)
- `modulo_1/` - Every frame (full detail)

---

### 3. generate_caption_ocr

Generates median frame from caption range and runs OCR.

**Configuration:**
- GPU: T4
- Timeout: 5 minutes
- Retries: 1

**Parameters:**
```python
chunks_prefix: str    # Wasabi prefix to cropped_frames_v{N}/
start_frame: int      # Caption start (inclusive)
end_frame: int        # Caption end (exclusive)
```

**Returns:** `CaptionOcrResult`
- `ocr_text`, `confidence`
- `frame_count`  # Frames used in median

**Processing:**
1. Downloads WebM chunks from range
2. Extracts frames
3. Computes per-pixel median
4. Runs Google Vision OCR on median frame

---

## Calling from Prefect Flows

```python
import modal

# Get Modal app handle
modal_app = modal.App.lookup("captionacc-processing")

# Get function handles
extract_fn = modal_app.functions["extract_frames_and_ocr"]
crop_infer_fn = modal_app.functions["crop_and_infer_caption_frame_extents"]
caption_ocr_fn = modal_app.functions["generate_caption_ocr"]

# Call function (blocks until complete)
result: ExtractResult = extract_fn.remote(
    video_key="tenant-123/client/videos/video-456/video.mp4",
    tenant_id="tenant-123",
    video_id="video-456",
    frame_rate=0.1
)

# Use typed result
print(f"Extracted {result.frame_count} frames")
print(f"OCR boxes: {result.ocr_box_count}")
```

---

## Error Handling

### Modal Function Exceptions

```python
from modal.exception import TimeoutError as ModalTimeout

try:
    result = extract_fn.remote(...)

except ModalTimeout:
    # Modal function exceeded timeout
    supabase.update_video_status(video_id, status="error",
                                 error_message="Processing timeout")
    raise

except modal.exception.RemoteError as e:
    # Modal function raised an exception
    supabase.update_video_status(video_id, status="error",
                                 error_message=str(e))
    raise
```

**Error Strategy:**
- Modal functions fail-fast (no partial results)
- Flows handle retries (Prefect retry logic)
- Status updates on error (user sees failure)

---

## Resource Allocation

### GPU Selection

| Function | GPU | Rationale |
|----------|-----|-----------|
| extract_frames_and_ocr | T4 | FFmpeg decode, sufficient for OCR |
| crop_and_infer | A10G | Inference model needs more VRAM |
| generate_caption_ocr | T4 | Small workload, T4 sufficient |

### Timeouts

| Function | Timeout | Rationale |
|----------|---------|-----------|
| extract_frames_and_ocr | 30 min | Long videos (2+ hours) |
| crop_and_infer | 60 min | Many frames + inference |
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

### Per-Video Costs (1-hour video)

| Operation | Duration | GPU | Cost |
|-----------|----------|-----|------|
| Initial processing | ~5 min | T4 | ~$0.05 |
| Crop + infer | ~15 min | A10G | ~$0.28 |
| Median OCR | ~30 sec | T4 | ~$0.01 |
| **Total** | | | **~$0.34** |

---

## Secrets Configuration

```bash
# Create Modal secrets
modal secret create wasabi \
  WASABI_ACCESS_KEY=xxx \
  WASABI_SECRET_KEY=xxx \
  WASABI_BUCKET=caption-acc-prod \
  WASABI_REGION=us-east-1

modal secret create google-vision \
  GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
```

---

## Deployment

```bash
cd data-pipelines/captionacc-modal

# Deploy all functions
modal deploy src/captionacc_modal/extract.py
modal deploy src/captionacc_modal/inference.py
modal deploy src/captionacc_modal/ocr.py

# Verify deployment
modal app list
# Should show: captionacc-processing with 3 functions
```

---

## Monitoring

### Modal Dashboard

Monitor at: https://modal.com/apps

**Metrics:**
- Function invocations
- GPU utilization
- Error rates
- Cost tracking

### From Prefect Flows

Log Modal call details:

```python
from prefect import get_run_logger

@flow
def my_flow(...):
    logger = get_run_logger()

    logger.info(f"Calling Modal extract_frames_and_ocr for video {video_id}")
    result = extract_fn.remote(...)
    logger.info(f"Modal complete: {result.frame_count} frames, "
                f"{result.processing_duration_seconds:.1f}s")
```

---

## Troubleshooting

### Function Not Found

```bash
# Verify Modal functions are deployed
modal app list

# Redeploy if needed
modal deploy src/captionacc_modal/extract.py
```

### Authentication Errors

```bash
# Check Modal token is configured
modal token list

# Set token if needed
modal token set --token-id xxx --token-secret xxx
```

### Timeout Issues

**Symptoms:** ModalTimeout exception

**Solutions:**
1. Check video size (very long videos may need higher timeout)
2. Verify GPU is available (not at capacity)
3. Check Modal dashboard for function logs

---

## Related Documentation

- [Architecture & Design](./ARCHITECTURE.md) - Why Modal, integration patterns
- [Flows Reference](./flows.md) - How flows call Modal functions
- [Data Architecture](../data-architecture/README.md) - Wasabi storage paths
