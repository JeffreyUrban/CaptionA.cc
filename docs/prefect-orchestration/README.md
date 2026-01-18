# Prefect Orchestration Architecture

Prefect orchestrates asynchronous workflows for CaptionA.cc, coordinating Modal GPU compute jobs and API processing steps, updating state in Supabase.

## Service Boundaries

| Service | Function | Infrastructure |
|---------|----------|----------------|
| **Prefect** | Job orchestration, workflow coordination | Fly.io (auto-stop) |
| **Modal** | Heavy compute: frames, OCR, cropping, inference | Modal (GPU, scales to 0) |
| **API** | Real-time sync, database processing | Fly.io (auto-stop) |

All services scale to zero when idle.

## Orchestrated Workflows

### 1. Video Initial Processing

```
Client ──presigned URL──▶ Wasabi (video.mp4)
                              │
                              ▼
Prefect: trigger on video record insert
    │
    ├──▶ Modal: extract_frames_and_ocr()
    │        video → full_frames/*.jpg → Wasabi
    │        video → thumbnails → Wasabi
    │        frames → OCR → raw-ocr.db.gz → Wasabi
    │        OCR boxes → layout.db.gz → Wasabi
    │
    └──▶ Supabase: videos.status = 'active'
```

**Trigger**: Supabase webhook on `videos` table insert

### 2. Crop and Inference

```
Prefect: trigger on layout approval
    │
    ├──▶ Modal: crop_and_infer_caption_frame_extents()
    │        video + crop region → cropped_frames/*.webm → Wasabi
    │        frame_pairs → inference → caption_frame_extents.db.gz → Wasabi
    │
    ├──▶ API: process_caption_frame_extents_results()
    │        caption_frame_extents_results → caption_frame_extents.db.gz → Wasabi
    │
    └──▶ Supabase: videos.caption_status = 'ready'
```

**Trigger**: API call when user approves layout

### 3. Median OCR

```
Prefect: trigger on caption frame extents confirmation
    │
    ├──▶ Modal: generate_caption_ocr()
    │        cropped_frames[start:end] → median_frame → OCR
    │
    └──▶ API: update_caption_text()
             captions.db: caption_ocr = result
```

**Trigger**: API call when user requests caption OCR (per-caption on-demand)

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Orchestration Architecture                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Client          Supabase         Prefect           Modal           API     │
│    │                │                │                │              │      │
│    │  1. Upload     │                │                │              │      │
│    ├───────────────►│                │                │              │      │
│    │                │                │                │              │      │
│    │  2. Insert     │  3. Webhook    │                │              │      │
│    │  video record  ├───────────────►│                │              │      │
│    │                │                │                │              │      │
│    │                │                │  4. Modal call │              │      │
│    │                │                ├───────────────►│              │      │
│    │                │                │                │              │      │
│    │                │                │  5. Complete   │              │      │
│    │                │                │◄───────────────┤              │      │
│    │                │                │                │              │      │
│    │                │  6. Update     │                │              │      │
│    │                │◄───────────────┤                │              │      │
│    │                │                │                │              │      │
│    │  7. Realtime   │                │                │              │      │
│    │◄───────────────┤                │                │              │      │
│    │                │                │                │              │      │
│    │  (Later: approve layout)        │                │              │      │
│    │                │                │                │              │      │
│    │  8. API call   │                │                │              │      │
│    ├────────────────┼────────────────┼────────────────┼─────────────►│      │
│    │                │                │                │              │      │
│    │                │                │  9. Trigger    │              │      │
│    │                │                │◄───────────────┼──────────────┤      │
│    │                │                │                │              │      │
│    │                │                │ 10. Modal call │              │      │
│    │                │                ├───────────────►│              │      │
│    │                │                │                │              │      │
│    │                │                │ 11. API call   │              │      │
│    │                │                ├────────────────┼─────────────►│      │
│    │                │                │                │              │      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prefect Flows

| Flow | Trigger | Steps                                                               |
|------|---------|---------------------------------------------------------------------|
| `captionacc-video-initial-processing` | Supabase webhook | Modal: frames + OCR                                                 |
| `captionacc-crop-and-infer-caption-frame-extents` | API call | Modal: crop + infer: caption_frame_extents.db.gz                       |
| `captionacc-caption-ocr` | API call | caption_frame_extents.db.gz, Modal: median + OCR → API: update caption |

See [Flows Reference](./flows.md) for detailed specifications.

## Infrastructure

Self-hosted Prefect on Fly.io with auto-stop.

- **Rationale**: Prefect Cloud free tier limited (5 deployments); paid tier expensive ($100/mo)
- **Cost**: ~$3/mo on Fly.io with auto-stop
- **Components**: Prefect Server + Worker

See [Infrastructure](./infrastructure.md) for deployment details.

## Related Documentation

- [Architecture & Design](./ARCHITECTURE.md) - Design decisions, patterns, and rationale
- [Flows Reference](./flows.md) - Flow definitions, parameters, state transitions
- [Infrastructure](./infrastructure.md) - Fly.io setup, worker configuration
- [Modal Integration](./modal-integration.md) - Modal function contracts, error handling
- [Operations](./operations.md) - Monitoring, debugging, recovery procedures
- [Test Plan](./TEST_PLAN.md) - Comprehensive testing strategy
- [Quick Start](./QUICKSTART.md) - Getting started guide
- [Data Architecture](../data-architecture/README.md) - Storage and database schemas
- [API Architecture](../api-architecture/architecture-decisions.md) - API design decisions
