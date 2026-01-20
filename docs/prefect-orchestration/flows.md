# Prefect Flows Reference

Specifications for each Prefect flow, including triggers, parameters, steps, and error handling.

---

## Flow Summary

| Flow | Trigger | Duration | Implementation |
|------|---------|----------|----------------|
| `captionacc-process-new-videos` | Realtime + cron | < 1 min | `services/api/app/flows/process_new_videos.py` |
| `captionacc-video-initial-processing` | process_new_videos | 2-10 min | `services/api/app/flows/video_initial_processing.py` |
| `captionacc-crop-and-infer-caption-frame-extents` | API call | 5-30 min | `services/api/app/flows/crop_and_infer.py` |
| `captionacc-caption-ocr` | API call | 10-30 sec | `services/api/app/flows/caption_ocr.py` |

---

## 1. captionacc-process-new-videos

Finds videos waiting to be processed and triggers their initial processing.

**Implementation:** `services/api/app/flows/process_new_videos.py`

### Trigger

**Primary:** Supabase Realtime subscription on `videos` table INSERT events.
When a video is inserted, the API service is notified immediately.

**Recovery:** Cron job every 15 minutes catches any missed Realtime events.

**Note:** The video record is only created after upload completes, ensuring
the file is ready for processing when the flow runs.

### Parameters

| Parameter | Type | Source | Description |
|-----------|------|--------|-------------|
| `video_id_hint` | UUID (optional) | Realtime | Video ID from Realtime event (optimization) |

### Processing Steps

1. **Query Supabase** → Find videos with `layout_status = 'wait'`
2. **For each video** → Trigger `video-initial-processing` flow
3. **Update status** → Mark as processing

---

## 2. captionacc-video-initial-processing

Extracts frames from uploaded video, runs OCR, and initializes layout.db for annotation.

**Implementation:** `services/api/app/flows/video_initial_processing.py`

### Trigger

**Triggered by:** `process_new_videos` flow (not called directly)

### Parameters

| Parameter | Type | Source | Description |
|-----------|------|--------|-------------|
| `video_id` | UUID | process_new_videos | Video identifier |
| `tenant_id` | UUID | process_new_videos | Tenant for path scoping |

**Note:** `storage_key` is computed as `{tenant_id}/client/videos/{video_id}/video.mp4` by the backend.

### Processing Steps

1. **Call Modal** → `extract_frames_and_ocr()` (T4 GPU, 30 min)
   - Extracts frames at 0.1 Hz
   - Runs Google Vision OCR
   - Uploads to Wasabi: `full_frames/`, `raw-ocr.db.gz`, `layout.db.gz`
2. **Update metadata** → `videos` table with frame count, duration, codec, etc.
3. **Update status** → `videos.status = 'active'`

### State Transitions

```
videos.status:
  processing → active
            → error (on failure)

Note: Video record is created with status 'processing' after upload completes.
The upload phase happens client-side before the video record exists.
```

### Outputs

| Output | Location | Description |
|--------|----------|-------------|
| `full_frames/*.jpg` | `{tenant}/client/videos/{id}/` | Full-resolution frames at 0.1Hz |
| `raw-ocr.db.gz` | `{tenant}/server/videos/{id}/` | Complete OCR results |
| `layout.db.gz` | `{tenant}/client/videos/{id}/` | Initial layout with OCR boxes |

### Error Handling

- Modal timeout → Mark video as 'error'
- OCR failure → Flow fails, Prefect retries
- Wasabi upload failure → Modal retries internally

---

## 3. captionacc-crop-and-infer-caption-frame-extents

Crops frames to caption region, runs inference, creates captions.db.

**Implementation:** `services/api/app/flows/crop_and_infer.py`

### Trigger

**API Endpoint:** `POST /videos/{video_id}/actions/approve-layout`

**Handler:** `services/api/app/routers/actions.py:approve_layout()`

### Parameters

| Parameter | Type | Source | Description |
|-----------|------|--------|-------------|
| `video_id` | UUID | API | Video identifier |
| `tenant_id` | UUID | JWT | Tenant for path scoping |
| `crop_region` | CropRegion | layout.db | Crop coordinates (0-1 normalized) |

### Processing Steps

1. **Acquire lock** → `video_database_state.lock_type = 'server'`
2. **Call Modal** → `crop_and_infer_caption_frame_extents()` (A10G GPU, 60 min)
   - Crops frames at 10 Hz
   - Encodes as VP9 WebM (modulo hierarchy)
   - Runs boundary inference
   - Uploads to Wasabi: `cropped_frames_v{N}/`, `caption_frame_extents.db.gz`
3. **Update metadata** → `videos.cropped_frames_version`, `label_counts`
4. **Update status** → `videos.caption_status = 'ready'`
5. **Release lock** (in finally block)

### State Transitions

```
videos.caption_status:
  null → processing → ready
                   → error (on failure)

Server lock:
  acquired → held during processing → released
```

### Outputs

| Output | Location | Description |
|--------|----------|-------------|
| `cropped_frames_v{N}/` | `{tenant}/client/videos/{id}/` | VP9 WebM chunks (modulo hierarchy) |
| `caption_frame_extents.db.gz` | `{tenant}/server/videos/{id}/` | Raw inference predictions |

### Lock Management

**Lock holder:** System (no user_id)
**Database:** `layout`
**Behavior:** Non-blocking acquire, immediate failure if locked

See: `services/api/app/services/supabase_service.py:acquire_server_lock()`

---

## 4. captionacc-caption-ocr

Generates median frame from caption range and runs OCR.

**Implementation:** `services/api/app/flows/caption_ocr.py`

### Trigger

**API Endpoint:** `POST /videos/{video_id}/captions/{caption_id}/request-ocr`

(Not yet implemented - flows are ready, endpoint pending)

### Parameters

| Parameter | Type | Source | Description |
|-----------|------|--------|-------------|
| `tenant_id` | UUID | API | Tenant identifier |
| `video_id` | UUID | API | Video identifier |
| `caption_id` | int | API | Caption record ID |
| `start_frame` | int | captions.db | Caption start frame |
| `end_frame` | int | captions.db | Caption end frame |
| `version` | int | Supabase | Cropped frames version |

### Processing Steps

1. **Call Modal** → `generate_caption_ocr()` (T4 GPU, 5 min)
   - Downloads WebM chunks for range
   - Computes per-pixel median
   - Runs Google Vision OCR
2. **Update captions.db** → Download, modify, re-upload
   - Sets `caption_ocr` field
   - Sets `confidence` field

### State Transitions

```
(Future implementation)
captions.caption_ocr_status:
  queued → processing → completed
                     → error
```

### Outputs

| Output | Location | Description |
|--------|----------|-------------|
| `caption_ocr` text | captions.db | OCR text for caption |

---

## Flow Registration

**Configuration:** `services/api/prefect.yaml`

Flow deployments are defined declaratively in `prefect.yaml` and registered using the Prefect CLI.

**Local/Manual Registration:**
```bash
cd services/api
export PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api
prefect deploy --all
```

**Production:** Flows are automatically registered when deploying the API service to Fly.io (`fly deploy` in `services/api`). The `fly.toml` release command runs `scripts/deploy_flows.sh`, which executes `prefect deploy --all`.

---

## Triggering Flows

### From Realtime Subscription

**Implementation:** `services/api/app/services/realtime_subscriber.py`

Subscribes to videos INSERT events → Triggers `process_new_videos` flow

### From Cron (Recovery)

**Implementation:** `services/api/crontab` + `scripts/trigger_process_new_videos.sh`

Every 15 minutes, queries for videos with `layout_status = 'wait'`

### From API Endpoints

**Implementation:** `services/api/app/routers/actions.py`

Direct flow triggering with authentication

---

## Concurrency Limits

Configured in work pool `captionacc-workers`:

| Flow | Max Concurrent | Rationale |
|------|----------------|-----------|
| video-initial-processing | 5 | Background, Modal scales |
| crop-and-infer | 2 | Expensive GPU, user-blocking |
| caption-ocr | 10 | Fast, lightweight |

---

## Related Documentation

- [Architecture & Design](./ARCHITECTURE.md) - Design decisions
- [Modal Integration](./modal-integration.md) - Modal function details
- [Infrastructure](./infrastructure.md) - Prefect server deployment
