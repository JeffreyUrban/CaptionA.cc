# Prefect Flows Reference

Detailed specifications for each Prefect flow, including parameters, steps, state transitions, and error handling.

## Flow Summary

| Flow | Trigger | Duration |
|------|---------|----------|
| `captionacc-video-initial-processing` | Supabase webhook | 2-10 min |
| `captionacc-crop-and-infer-caption-frame-extents` | API call | 5-30 min |
| `captionacc-caption-ocr` | API call | 10-30 sec |

---

## 1. captionacc-video-initial-processing

Extracts frames from uploaded video, runs OCR, and initializes layout.db for annotation.

### Trigger

**Supabase Database Webhook** on `videos` table INSERT

```python
# Webhook payload
{
    "type": "INSERT",
    "table": "videos",
    "record": {
        "id": "uuid",
        "tenant_id": "uuid",
        "storage_key": "{tenant_id}/client/videos/{video_id}/video.mp4",
        "status": "uploading",
        "file_size_bytes": 104857600,
        "filename": "lecture.mp4"
    }
}
```

### Parameters

| Parameter | Type | Source | Description |
|-----------|------|--------|-------------|
| `video_id` | UUID | webhook | Video identifier |
| `tenant_id` | UUID | webhook | Tenant for path scoping |
| `storage_key` | string | webhook | Wasabi S3 key for video file |

### Steps

```python
@flow(name="captionacc-video-initial-processing")
def captionacc_video_initial_processing(video_id: str, tenant_id: str, storage_key: str):
    # 1. Update status to 'processing'
    update_video_status(video_id, status="processing")

    # 2. Call Modal for frame extraction and OCR
    result = modal_extract_frames_and_ocr.remote(
        video_key=storage_key,
        tenant_id=tenant_id,
        video_id=video_id,
        frame_rate=0.1,  # 1 frame per 10 seconds
    )
    # Modal uploads directly to Wasabi:
    #   - {tenant_id}/client/videos/{video_id}/full_frames/*.jpg
    #   - {tenant_id}/server/videos/{video_id}/raw-ocr.db.gz
    #   - {tenant_id}/client/videos/{video_id}/layout.db.gz

    # 3. Update Supabase with results
    update_video_metadata(
        video_id=video_id,
        frame_count=result.frame_count,
        duration_seconds=result.duration,
        status="active"
    )

    return {"video_id": video_id, "frame_count": result.frame_count}
```

### State Transitions

```
videos.status: 'uploading' → 'processing' → 'active'
                                         → 'error' (on failure)
```

### Outputs

| Output | Location | Description                           |
|--------|----------|---------------------------------------|
| `full_frames/*.jpg` | `{tenant}/client/videos/{id}/` | Full-resolution frames at 0.1Hz       |
| `raw-ocr.db.gz` | `{tenant}/server/videos/{id}/` | Complete OCR results from full frames |
| `layout.db.gz` | `{tenant}/client/videos/{id}/` | Initial layout with OCR boxes         |

### Error Handling

| Error | Action | Retry |
|-------|--------|-------|
| Modal timeout | Mark video as 'error', log details | No |
| OCR API failure | Retry OCR step only | 3 attempts, exponential backoff |
| Wasabi upload failure | Retry upload | 3 attempts |
| Invalid video format | Mark as 'error', notify user | No |

---

## 2. captionacc-crop-and-infer-caption-frame-extents

Crops frames to crop region, runs caption frame extents inference, and creates caption_frame_extents.db.

### Trigger

**API Call** when user approves layout (initial or updated)

```python
# API endpoint
POST /videos/{video_id}/approve-layout

# Request body
{
    "crop_region": {
        "crop_left": 0.1,
        "crop_top": 0.7,
        "crop_right": 0.9,
        "crop_bottom": 0.95
    }
}
```

### Parameters

| Parameter        | Type | Source | Description                         |
|------------------|------|--------|-------------------------------------|
| `video_id`       | UUID | API | Video identifier                    |
| `tenant_id`      | UUID | JWT | Tenant for path scoping             |
| `crop_region`    | object | API/layout.db | Crop region (0-1 normalized)        |
| `layout_version` | int | layout.db | Version hash for cache invalidation |

### Steps

```python
@flow(name="captionacc-crop-and-infer-caption-frame-extents")
def captionacc_crop_and_infer_caption_frame_extents(video_id: str, tenant_id: str, crop_region: dict):
    # 1. Acquire server lock on video
    acquire_server_lock(video_id, lock_type="processing")

    try:
        # 2. Call Modal for cropping and inference
        modal_result = modal_crop_and_infer_caption_frame_extents.remote(
            video_key=f"{tenant_id}/client/videos/{video_id}/video.mp4",
            tenant_id=tenant_id,
            video_id=video_id,
            crop_region=crop_region,
            frame_rate=10.0,  # 10 frames per second for captions
        )
        # Modal uploads:
        #   - {tenant_id}/client/videos/{video_id}/cropped_frames_v{N}/*.webm
        #   - {tenant_id}/server/videos/{video_id}/caption_frame_extents.db

        # 3. Call API to process inference results into captions.db
        api_process_inference(
            video_id=video_id,
            caption_frame_extents_results_key=modal_result.caption_frame_extents_db_key,
            cropped_frames_version=modal_result.version
        )
        # API creates:
        #   - {tenant_id}/client/videos/{video_id}/captions.db.gz

        # 4. Update Supabase
        update_cropped_frames_version(
            video_id=video_id,
            version=modal_result.version,
            frame_count=modal_result.frame_count
        )
        update_video_status(video_id, caption_status="ready")

    finally:
        # 5. Release server lock
        release_server_lock(video_id)

    return {
        "video_id": video_id,
        "cropped_frames_version": modal_result.version,
        "caption_count": modal_result.caption_count
    }
```

### State Transitions

```
videos.caption_status: NULL → 'processing' → 'ready'
                                           → 'error' (on failure)

Server lock: acquired during flow, released on completion/failure
```

### Outputs

| Output | Location | Description |
|--------|----------|-------------|
| `cropped_frames_v{N}/` | `{tenant}/client/videos/{id}/` | VP9 WebM chunks (modulo hierarchy) |
| `caption_frame_extents.db` | `{tenant}/server/videos/{id}/` | Raw inference predictions |
| `captions.db.gz` | `{tenant}/client/videos/{id}/` | Initial caption frame extents |

### Error Handling

| Error | Action | Retry |
|-------|--------|-------|
| Modal timeout | Release lock, mark 'error' | No (expensive) |
| Inference model failure | Log, mark 'error' | No |
| API processing failure | Retry API step | 2 attempts |
| Lock acquisition timeout | Abort flow | No |

### Blocking Behavior

This flow blocks the user from editing the video:
1. Client receives lock status via Supabase Realtime
2. UI shows processing indicator
3. On completion, client receives 'ready' status and can proceed

---

## 3. captionacc-caption-ocr

Generates a median frame from a caption range and runs OCR to extract text.

### Trigger

**API Call** when user confirms caption frame extents

```python
# API endpoint
POST /videos/{video_id}/captions/{caption_id}/request-ocr
```

### Parameters

| Parameter | Type | Source | Description |
|-----------|------|--------|-------------|
| `video_id` | UUID | API | Video identifier |
| `caption_id` | int | API | Caption record ID |
| `start_frame` | int | captions.db | Caption start frame index |
| `end_frame` | int | captions.db | Caption end frame index |
| `cropped_frames_version` | int | Supabase | Version of cropped frames to use |

### Steps

```python
@flow(name="captionacc-caption-ocr")
def captionacc_caption_ocr(video_id: str, caption_id: int, start_frame: int, end_frame: int, version: int):
    # 1. Update caption status
    update_caption_ocr_status(video_id, caption_id, status="processing")

    try:
        # 2. Call Modal to generate median and run OCR
        result = modal_caption_ocr.remote(
            chunks_prefix=f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/",
            start_frame=start_frame,
            end_frame=end_frame
        )

        # 3. Update caption with OCR result
        api_update_caption_text(
            video_id=video_id,
            caption_id=caption_id,
            caption_ocr=result.ocr_text,
            confidence=result.confidence
        )

        update_caption_ocr_status(video_id, caption_id, status="completed")

    except Exception as e:
        update_caption_ocr_status(video_id, caption_id, status="error", error=str(e))
        raise

    return {"caption_id": caption_id, "text": result.ocr_text}
```

### State Transitions

```
captions.caption_ocr_status: 'queued' → 'processing' → 'completed'
                                                    → 'error'
```

### Outputs

| Output | Location | Description             |
|--------|----------|-------------------------|
| `caption_ocr` | captions.db | Caption OCR text result |

### Error Handling

| Error | Action | Retry |
|-------|--------|-------|
| Modal failure | Mark 'error', log | 1 retry |
| OCR API failure | Mark 'error' | 2 retries |
| Invalid frame range | Mark 'error', no retry | No |

### Async Behavior

This flow runs asynchronously:
1. API returns immediately with 202 Accepted
2. Client polls or receives update via CR-SQLite sync
3. UI updates when `caption_ocr_status` changes to 'completed'

---

## Flow Configuration

### Prefect Settings

```python
# prefect.yaml
deployments:
  - name: captionacc-video-initial-processing
    entrypoint: flows/video_processing.py:captionacc_video_initial_processing
    work_pool:
      name: captionacc-workers
    tags:
      - captionacc
      - processing
      - modal

  - name: captionacc-crop-and-infer-caption-frame-extents
    entrypoint: flows/crop_inference.py:captionacc_crop_and_infer_caption_frame_extents
    work_pool:
      name: captionacc-workers
    tags:
      - captionacc
      - processing
      - modal
      - blocking

  - name: captionacc-caption-ocr
    entrypoint: flows/caption_ocr.py:captionacc_caption_ocr
    work_pool:
      name: captionacc-workers
    tags:
      - captionacc
      - ocr
      - modal
```

### Concurrency

| Flow | Max Concurrent | Rationale |
|------|----------------|-----------|
| `captionacc-video-initial-processing` | 5 | Modal scales, Supabase can handle |
| `captionacc-crop-and-infer-caption-frame-extents` | 2 | Expensive GPU ops, user-blocking |
| `captionacc-caption-ocr` | 10 | Fast, lightweight |

### Timeouts

| Flow | Timeout | Rationale |
|------|---------|-----------|
| `captionacc-video-initial-processing` | 30 min | Long videos may take time |
| `captionacc-crop-and-infer-caption-frame-extents` | 60 min | Inference on many frames |
| `captionacc-caption-ocr` | 5 min | Single frame OCR |

---

## Implementation Notes

### Triggering Flows from API

```python
from prefect.client import get_client

async def trigger_captionacc_crop_and_infer_caption_frame_extents(video_id: str, tenant_id: str, crop_region: dict):
    async with get_client() as client:
        deployment = await client.read_deployment_by_name("captionacc-crop-and-infer-caption-frame-extents/production")
        flow_run = await client.create_flow_run_from_deployment(
            deployment.id,
            parameters={
                "video_id": video_id,
                "tenant_id": tenant_id,
                "crop_region": crop_region
            }
        )
        return flow_run.id
```

### Webhook Handler for Supabase

```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/webhooks/supabase/videos")
async def handle_video_insert(request: Request):
    payload = await request.json()

    if payload["type"] == "INSERT":
        record = payload["record"]
        await trigger_captionacc_video_initial_processing(
            video_id=record["id"],
            tenant_id=record["tenant_id"],
            storage_key=record["storage_key"]
        )

    return {"status": "accepted"}
```

## Related Documentation

- [README](./README.md) - Architecture overview
- [Modal Integration](./modal-integration.md) - Modal function specifications
- [Infrastructure](./infrastructure.md) - Deployment configuration
