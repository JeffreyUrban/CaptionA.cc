# Modal Function Interface Contract

This document defines the exact function signatures that must be implemented in the Modal functions package. These are the contracts between Modal GPU functions and Prefect orchestration flows.

## Function 1: extract_frames_and_ocr

**Purpose:** Extract frames from video at low frequency (0.1Hz) and run OCR on each frame.

**GPU:** T4
**Timeout:** 30 minutes (1800 seconds)
**Retries:** 0 (orchestration layer handles retries)

### Function Signature

```python
@app.function(
    gpu="T4",
    timeout=1800,
    retries=0,
    secrets=[
        modal.Secret.from_name("wasabi"),
        modal.Secret.from_name("google-vision")
    ]
)
def extract_frames_and_ocr(
    video_key: str,
    tenant_id: str,
    video_id: str,
    frame_rate: float = 0.1
) -> ExtractResult:
    """
    Extract frames from video and run OCR on each frame.

    Args:
        video_key: Wasabi S3 key for video file
                   Example: "tenant-123/client/videos/video-456/video.mp4"
        tenant_id: Tenant UUID for path scoping
                   Example: "550e8400-e29b-41d4-a716-446655440000"
        video_id: Video UUID
                  Example: "660e8400-e29b-41d4-a716-446655440000"
        frame_rate: Frames per second to extract (default: 0.1 = 1 frame per 10 seconds)

    Returns:
        ExtractResult with:
        - frame_count: Number of frames extracted
        - duration: Video duration in seconds
        - ocr_box_count: Total OCR detections across all frames
        - full_frames_key: S3 path to frames directory
        - ocr_db_key: S3 path to raw-ocr.db.gz (server-only)
        - layout_db_key: S3 path to layout.db.gz (client-accessible)

    Processing Steps:
        1. Download video from Wasabi
        2. Extract frames using FFmpeg (GPU-accelerated if available)
        3. Generate thumbnails (resized frames)
        4. Run Google Vision OCR on each frame
        5. Create raw-ocr.db.gz with full OCR results
        6. Create layout.db.gz with box positions
        7. Upload all outputs to Wasabi
        8. Return result summary

    Wasabi Outputs:
        - Frames: {tenant_id}/client/videos/{video_id}/full_frames/frame_{NNNNNN}.jpg
        - OCR DB: {tenant_id}/server/videos/{video_id}/raw-ocr.db.gz
        - Layout DB: {tenant_id}/client/videos/{video_id}/layout.db.gz
    """
    pass  # Implementation here
```

---

## Function 2: crop_and_infer_caption_frame_extents

**Purpose:** Crop frames to caption region, encode as WebM, and run caption frame extents inference.

**GPU:** A10G
**Timeout:** 60 minutes (3600 seconds)
**Retries:** 0 (orchestration layer handles retries)

### Function Signature

```python
@app.function(
    gpu="A10G",
    timeout=3600,
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
    """
    Crop frames to caption region and run caption frame extents inference.

    Args:
        video_key: Wasabi S3 key for video file
                   Example: "tenant-123/client/videos/video-456/video.mp4"
        tenant_id: Tenant UUID for path scoping
        video_id: Video UUID
        crop_region: Normalized crop region (0.0 to 1.0)
                    Example: CropRegion(crop_left=0.1, crop_top=0.7, crop_right=0.9, crop_bottom=0.95)
        frame_rate: Frames per second to extract (default: 10.0)

    Returns:
        CropInferResult with:
        - version: Cropped frames version number (increment on crop region change)
        - frame_count: Number of frames in cropped output
        - caption_frame_extents_count: Number of caption frame extents detected
        - caption_frame_extents_db_key: S3 path to caption_frame_extents.db (server-only)
        - cropped_frames_prefix: S3 path prefix to cropped_frames_v{N}/ directory

    Processing Steps:
        1. Download video and layout.db from Wasabi
        2. Crop and extract frames at 10Hz using FFmpeg
        3. Encode frames as VP9 WebM chunks (modulo hierarchy: 16, 4, 1)
        4. Generate frame pairs for inference
        5. Run caption frame extents inference model on pairs
        6. Store predictions in caption_frame_extents.db
        7. Upload chunks and DB to Wasabi
        8. Return result summary

    Wasabi Outputs:
        - WebM chunks: {tenant_id}/client/videos/{video_id}/cropped_frames_v{N}/modulo_{M}/chunk_{NNNN}.webm
        - Inference DB: {tenant_id}/server/videos/{video_id}/caption_frame_extents.db

    Modulo Hierarchy:
        cropped_frames_v1/
        ├── modulo_16/   # Every 16th frame (coarse preview)
        ├── modulo_4/    # Every 4th frame (medium detail)
        └── modulo_1/    # Every frame (full detail)
    """
    pass  # Implementation here
```

---

## Function 3: generate_caption_ocr

**Purpose:** Generate median frame from frame range and run OCR.

**GPU:** T4
**Timeout:** 5 minutes (300 seconds)
**Retries:** 1 (lightweight operation, can retry)

### Function Signature

```python
@app.function(
    gpu="T4",
    timeout=300,
    retries=1,
    secrets=[
        modal.Secret.from_name("wasabi"),
        modal.Secret.from_name("google-vision")
    ]
)
def generate_caption_ocr(
    chunks_prefix: str,
    start_frame: int,
    end_frame: int
) -> CaptionOcrResult:
    """
    Generate median frame from range and run OCR.

    Args:
        chunks_prefix: Wasabi S3 prefix for cropped frames
                      Example: "tenant-123/client/videos/video-456/cropped_frames_v1/"
        start_frame: Start frame index (inclusive)
                    Example: 1200 (frame at 2 minutes if 10fps)
        end_frame: End frame index (exclusive)
                  Example: 1350 (frame at 2:15 if 10fps)

    Returns:
        CaptionOcrResult with:
        - ocr_text: Extracted text from median frame
        - confidence: OCR confidence score (0.0 to 1.0)
        - frame_count: Number of frames used to generate median
        - median_frame_index: Index of the middle frame (optional, for debugging)

    Processing Steps:
        1. Download relevant WebM chunks from Wasabi
        2. Extract frames in range [start_frame, end_frame)
        3. Compute per-pixel median across frames
        4. Run Google Vision OCR on median frame
        5. Return OCR text result

    Notes:
        - Median frame reduces noise from video compression artifacts
        - Works across modulo hierarchy (downloads only needed chunks)
        - No Wasabi uploads (result returned directly)
    """
    pass  # Implementation here
```

---

## Data Models

All data models are defined in `captionacc_modal/models.py`:

```python
from dataclasses import dataclass

@dataclass
class CropRegion:
    crop_left: float    # 0.0 to 1.0
    crop_top: float     # 0.0 to 1.0
    crop_right: float   # 0.0 to 1.0
    crop_bottom: float  # 0.0 to 1.0

@dataclass
class ExtractResult:
    frame_count: int
    duration: float
    ocr_box_count: int
    full_frames_key: str
    ocr_db_key: str
    layout_db_key: str

@dataclass
class CropInferResult:
    version: int
    frame_count: int
    caption_frame_extents_count: int
    caption_frame_extents_db_key: str
    cropped_frames_prefix: str

@dataclass
class CaptionOcrResult:
    ocr_text: str
    confidence: float
    frame_count: int
    median_frame_index: Optional[int] = None
```

---

## Testing Requirements

Each function must be testable independently:

```python
# Test extract_frames_and_ocr
result = extract_frames_and_ocr.remote(
    video_key="test-tenant/client/videos/test-video/video.mp4",
    tenant_id="test-tenant",
    video_id="test-video",
    frame_rate=0.1
)
assert result.frame_count > 0
assert result.duration > 0
assert result.ocr_box_count >= 0

# Test crop_and_infer_caption_frame_extents
crop_region = CropRegion(crop_left=0.1, crop_top=0.7, crop_right=0.9, crop_bottom=0.95)
result = crop_and_infer_caption_frame_extents.remote(
    video_key="test-tenant/client/videos/test-video/video.mp4",
    tenant_id="test-tenant",
    video_id="test-video",
    crop_region=crop_region,
    frame_rate=10.0
)
assert result.version >= 1
assert result.frame_count > 0

# Test generate_caption_ocr
result = generate_caption_ocr.remote(
    chunks_prefix="test-tenant/client/videos/test-video/cropped_frames_v1/",
    start_frame=100,
    end_frame=150
)
assert len(result.ocr_text) >= 0
assert 0.0 <= result.confidence <= 1.0
```

---

## Error Handling

Functions should raise exceptions for failures (Modal SDK handles retries):

```python
# Validation errors
if not video_key:
    raise ValueError("video_key is required")

# Processing errors
try:
    frames = extract_frames(video_path)
except FFmpegError as e:
    raise RuntimeError(f"Frame extraction failed: {e}")

# OCR errors
try:
    ocr_result = run_google_vision_ocr(frame)
except Exception as e:
    # Log but don't fail entire job for single frame OCR failure
    logger.warning(f"OCR failed for frame: {e}")
    ocr_result = None
```

---

## Secrets Configuration

Required Modal secrets:

```bash
# Wasabi S3 credentials
modal secret create wasabi \
  WASABI_ACCESS_KEY=xxx \
  WASABI_SECRET_KEY=xxx \
  WASABI_BUCKET=caption-acc-prod \
  WASABI_REGION=us-east-1

# Google Vision API credentials
modal secret create google-vision \
  GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
```

---

## Implementation Notes

1. **Reuse existing code:**
   - Frame extraction: `/data-pipelines/crop_frames/`
   - OCR: `/data-pipelines/full_frames/`
   - Inference: `/data-pipelines/caption_frame_extents/`

2. **Modal app setup:**
   ```python
   import modal
   app = modal.App("captionacc-processing")
   ```

3. **GPU images:**
   - T4: Standard image with FFmpeg and Python packages
   - A10G: Image with inference model + dependencies

4. **Logging:**
   - Use `print()` for logs (Modal captures stdout)
   - Log key metrics (frame count, duration, timing)

5. **Performance:**
   - Use GPU-accelerated FFmpeg when available
   - Batch OCR requests to Vision API
   - Stream uploads to Wasabi (don't buffer entire files in memory)

---

## Deployment

```bash
# Deploy all functions
cd data-pipelines/captionacc-modal
modal deploy src/captionacc_modal/app.py

# Test individual function
modal run src/captionacc_modal/app.py::extract_frames_and_ocr \
  --video-key "test/video.mp4" \
  --tenant-id "test-tenant" \
  --video-id "test-video"
```
