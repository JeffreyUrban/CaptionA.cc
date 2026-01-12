# Prefect Orchestration Architecture

Prefect orchestrates asynchronous workflows for CaptionA.cc, coordinating Modal GPU compute jobs and updating state in Supabase.

## Service Boundaries

| Service | Function | Infrastructure |
|---------|----------|----------------|
| **Prefect** | Job orchestration, workflow coordination | Fly.io (auto-stop) |
| **Modal** | Heavy compute: frames, OCR, cropping, inference | Modal (GPU, scales to 0) |
| **API** | Real-time sync: CR-SQLite WebSocket, locks | Fly.io (auto-stop) |

All services scale to zero when idle.

## Data Flows Requiring Orchestration

From [Data Architecture](../data-architecture/README.md) and [API Architecture](../api-architecture/architecture-decisions.md):

### 1. UPLOAD + INITIAL PROCESSING
```
Client ──presigned URL──▶ Wasabi (video.mp4)
Modal: video → full_frames → thumbnails → OCR → ocr-server.db → Wasabi
                                              → layout.db (boxes) → Wasabi
```
**Trigger**: Upload completes (Supabase video record created)

### 2. CROP + INFERENCE
```
Modal: video + bounds → crop_frames → inference_results → Wasabi
API:   inference_results → captions.db → Wasabi
```
**Trigger**: User approves layout (initial or after update)
<!-- TODO: Determine trigger mechanism - Supabase state change or API call? -->

## Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Orchestration Architecture                         │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐   │
│   │   Client    │    │  Supabase   │    │   Prefect   │    │    Modal     │   │
│   │   (SPA)     │    │ (Postgres)  │    │  (Fly.io)   │    │    (GPU)     │   │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬───────┘   │
│          │                  │                  │                   │           │
│   1. Upload video           │                  │                   │           │
│   ───────────────►          │                  │                   │           │
│          │                  │                  │                   │           │
│   2. Insert record          │                  │                   │           │
│   ──────────────────────────►                  │                   │           │
│          │                  │                  │                   │           │
│          │   3. Trigger (webhook/realtime)     │                   │           │
│          │   ──────────────────────────────────►                   │           │
│          │                  │                  │                   │           │
│          │                  │   4. Call Modal function             │           │
│          │                  │   ──────────────────────────────────►│           │
│          │                  │                  │                   │           │
│          │                  │                  │   5. Modal runs   │           │
│          │                  │                  │   (frames, OCR)   │           │
│          │                  │                  │   ◄───────────────│           │
│          │                  │                  │                   │           │
│          │   6. Update status (status='active')                    │           │
│          │   ◄──────────────────────────────────                   │           │
│          │                  │                  │                   │           │
│   7. Realtime notification  │                  │                   │           │
│   ◄──────────────────────────                  │                   │           │
│                                                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Prefect Flows

| Flow | Trigger | Purpose |
|------|---------|---------|
| `video-initial-processing` | Video upload | Extract frames, OCR, initialize layout.db |
| `crop-and-infer` | Layout approval | Crop frames, run boundary inference, create captions.db |
| `median-ocr` | Caption boundary confirmed | Generate median frame, OCR for caption text |

See [Flows Reference](./flows.md) for detailed specifications.

## Infrastructure

### Self-Hosted Prefect (Fly.io)
- **Rationale**: Prefect Cloud free tier limited to 5 deployments; paid tier $100/mo
- **Cost**: ~$3/mo on Fly.io with auto-stop
- **Components**:
  - Prefect Server (API + UI)
  - Prefect Worker (ProcessWorker)

See [Infrastructure](./infrastructure.md) for deployment details.

### Trigger Mechanisms

| Trigger Type | Best For | Notes |
|--------------|----------|-------|
| Supabase Webhook | video-initial-processing | Push-based, stateless |
| API Direct Call | crop-and-infer, median-ocr | User-initiated, synchronous response |

## Related Documentation

- [Flows Reference](./flows.md) - Flow definitions, parameters, triggers
- [Infrastructure](./infrastructure.md) - Fly.io setup, worker config
- [Modal Integration](./modal-integration.md) - Modal function contracts
- [Operations](./operations.md) - Monitoring, debugging, recovery
- [Data Architecture](../data-architecture/README.md) - Storage and sync
- [API Architecture](../api-architecture/architecture-decisions.md) - API design
