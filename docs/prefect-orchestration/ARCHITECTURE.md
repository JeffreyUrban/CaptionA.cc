# Prefect Orchestration - Architecture & Design

This document explains the architecture and key design decisions for the Prefect orchestration system.

## Table of Contents

1. [Overview](#overview)
2. [Why Prefect?](#why-prefect)
3. [Service Ownership Model](#service-ownership-model)
4. [Component Interaction](#component-interaction)
5. [Key Design Decisions](#key-design-decisions)
6. [Integration Patterns](#integration-patterns)

---

## Overview

Prefect orchestrates asynchronous workflows for CaptionA.cc, coordinating Modal GPU compute jobs and API processing steps, updating state in Supabase.

### System Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │────▶│ Supabase │◀───▶│   API    │────▶│  Modal   │
│          │     │          │     │ Service  │     │  (GPU)   │
│          │     │          │     │ (flows)  │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                  (Realtime)            │
                                        ▼
                                   ┌──────────┐
                                   │ Prefect  │
                                   │  Server  │
                                   └──────────┘
```

### Service Boundaries

| Service | Function | Infrastructure |
|---------|----------|----------------|
| **Prefect** | Job orchestration, workflow coordination | Fly.io (auto-stop) |
| **Modal** | Heavy compute: frames, OCR, cropping, inference | Modal (GPU, scales to 0) |
| **API** | Real-time sync, database processing | Fly.io (auto-stop) |

All services scale to zero when idle.

---

## Why Prefect?

### Requirements

We needed:
1. **Orchestration** of long-running, multi-step GPU workflows
2. **Priority queuing** by tenant tier with age-based fairness
3. **Observability** with flow run history and logging
4. **Reliability** with automatic retries and error handling
5. **Cost efficiency** at low scale (< 10 videos/day initially)

### Why Not Alternatives?

**Why not direct Modal calls?**
- No queuing or priority management
- No visibility into job status
- No retry logic
- Each flow would need custom orchestration code

**Why not Temporal/Celery?**
- Temporal: Complex setup, expensive ($200+/mo managed), overkill for our scale
- Celery: Requires Redis/RabbitMQ infrastructure, less observability

**Why not AWS Step Functions?**
- Vendor lock-in
- Poor local development experience
- Modal already handles compute layer

### Prefect Advantages

- **Self-hosted for cheap** (~$3/mo on Fly.io with auto-stop)
- **Built-in priority queuing** (work pools)
- **Excellent UI** for flow run monitoring
- **Python-native** with type hints and decorators
- **Flexible deployment** (server and workers separate)
- **Free for self-hosted** (unlimited flows)

---

## Service Ownership Model

### Prefect Server (Coordination Only)

**URL:** `https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api`

**Responsibilities:**
- Track flow run state (scheduled, running, completed, failed)
- Provide work queue for workers
- Store flow run history
- Serve web UI for monitoring

**Not Responsible For:**
- Executing application code
- Knowing business logic
- Direct database or storage access

### API Service (Owns Flows)

**Location:** `/services/api/`

**Responsibilities:**
- Define all Prefect flows (`app/flows/`)
- Run Prefect worker process
- Execute flow logic (orchestrate Modal calls, update databases)
- Subscribe to Supabase Realtime (videos INSERT → trigger flows)
- Provide endpoints (user actions → trigger flows)

**Key Point:** Flows execute **inside the API service process**, not on Prefect server.

### Modal (GPU Compute)

**Location:** `/data-pipelines/captionacc-modal/`

**Responsibilities:**
- Heavy computation (frame extraction, OCR, inference)
- GPU resource management
- Direct Wasabi uploads (avoid API bottleneck)

**Not Responsible For:**
- Orchestration logic
- Database updates
- Lock management

---

## Component Interaction

### Flow Triggering Paths

**Path 1: Realtime Subscription (Automatic - Primary)**
```
User uploads video
    ↓
Edge Function creates video record in Supabase
    ↓
Supabase Realtime notifies API service (INSERT event)
    ↓
API triggers process_new_videos flow immediately
    ↓
Flow finds video with layout_status='wait'
    ↓
Triggers video-initial-processing flow
    ↓
Flow executes in API service process
```

**Recovery fallback:** A cron job runs every 15 minutes to catch any missed
Realtime events (network issues, API restarts, etc.).

**Path 2: User Action (On-Demand)**
```
User approves layout
    ↓
POST /videos/{id}/actions/approve-layout (API service)
    ↓
Calculate priority
    ↓
Prefect API: create_flow_run_from_deployment()
    ↓
Flow queued and executed (same as above)
```

### Lock Management

Flows use server locks to prevent concurrent modifications:

```python
# In crop-and-infer flow
acquired = supabase_service.acquire_server_lock(
    video_id=video_id,
    database_name="layout"  # Per-database granularity
)

if not acquired:
    raise Exception("Video is being processed")

try:
    # Process video...
finally:
    supabase_service.release_server_lock(video_id, "layout")
```

**Design Decision:** Non-blocking lock acquisition. Flow decides retry strategy.

---

## Key Design Decisions

### 1. Priority Calculation

**Decision:** Dynamic priority with configurable age-based boosting

```python
priority = calculate_flow_priority(
    tenant_tier="premium",           # Base: free=50, premium=70, enterprise=90
    request_time=video_created_at,   # For age boosting
    enable_age_boosting=True,        # Default: enabled
    age_boost_per_minutes=60,        # +1 point per hour
    age_boost_cap=20                 # Max +20 points
)
```

**Rationale:**
- Tenant tiers provide base differentiation
- Age boosting prevents starvation (old free-tier jobs eventually get priority)
- Configurable rates allow tuning per use case
- Default behavior prevents neglected jobs

**Example:** A free-tier video uploaded 20 hours ago has same priority (70) as a newly uploaded premium video.

### 2. Service Ownership

**Decision:** API service owns and executes flows, Prefect server only coordinates

**Why not execute flows on Prefect server?**
- Prefect server becomes application-specific (violates separation of concerns)
- Harder to deploy (need access to all secrets, dependencies)
- Scaling issues (server now handles both coordination AND compute)

**Benefits of current approach:**
- Prefect server is generic (just coordination)
- API service can scale independently
- Secrets stay in API service
- Easier testing (flows run locally)

### 3. Modal Function Granularity

**Decision:** Three separate Modal functions instead of one monolithic function

**Functions:**
1. `extract_frames_and_ocr` (T4 GPU, 30 min) - Initial processing
2. `crop_and_infer_caption_frame_extents` (A10G GPU, 60 min) - Heavy inference
3. `generate_caption_ocr` (T4 GPU, 5 min) - Fast per-caption OCR

**Rationale:**
- Different GPU requirements (T4 vs A10G)
- Different timeout needs (5 min vs 60 min)
- Independent retries (OCR failure doesn't retry inference)
- Better cost control (don't pay for A10G when T4 suffices)

### 4. Fail-Fast Error Handling

**Decision:** Modal functions raise exceptions on error, no partial results

**Current Behavior:**
```python
# If OCR fails on frame 23
raise RuntimeError("OCR failed on frame 23: timeout")

# Flow receives exception, no partial data uploaded
```

**Rationale:**
- Simpler error handling in flows
- No partial/corrupt data in storage
- Clear failure signals
- Most errors are transient (retry succeeds)

**Future Enhancement:** Support partial results when beneficial (documented in code).

### 5. Lock Granularity

**Decision:** Per-database locks (can lock `layout.db` independently of `captions.db`)

**Why not per-video locks?**
- Too coarse - blocks unrelated operations
- Example: Can't run caption OCR while crop-and-infer is processing

**Why not per-caption locks?**
- Too fine-grained - complexity without benefit
- Caption operations are fast (< 30s)

**Implementation:**
```python
acquire_server_lock(video_id, "layout")   # Locks layout.db only
acquire_server_lock(video_id, "captions") # Locks captions.db only
```

### 6. Realtime vs Webhooks

**Decision:** Use Supabase Realtime subscriptions instead of webhooks

**Rationale:**
- API subscribes to Supabase, not vice versa (no URL configuration needed)
- Works identically in dev and prod environments
- No webhook secrets to manage
- Immediate processing (no webhook delivery delay)
- Built-in reconnection handling

**Implementation:** `services/api/app/services/realtime_subscriber.py`

### 7. Caption OCR Storage

**Decision:** Store OCR text in `captions.db` (Wasabi), not Supabase

**Rationale:**
- Client needs offline access (CR-SQLite syncs captions.db)
- Supabase would duplicate data (client still needs local copy)
- Single source of truth (Wasabi)
- API manages download/modify/upload lifecycle

### 8. Worker Deployment

**Decision:** Worker runs as subprocess in API service (not separate service)

**Why not separate worker service?**
- Additional deployment complexity
- Need to duplicate API service dependencies
- Harder to share code (flows import from `app/`)
- More infrastructure to monitor

**Benefits of subprocess:**
- Single deployment
- Shared dependencies
- Automatic lifecycle (starts/stops with API)
- Graceful degradation (API works even if worker fails to start)

---

## Integration Patterns

### Pattern 1: Modal Function Calls

Flows call Modal functions remotely:

```python
# In Prefect flow
result = modal_extract_frames_and_ocr.remote(
    video_key=storage_key,
    tenant_id=tenant_id,
    video_id=video_id,
    frame_rate=0.1
)

# Result is typed (ExtractResult dataclass)
print(f"Extracted {result.frame_count} frames")
```

**Key Points:**
- `.remote()` blocks until complete
- Exceptions propagate to flow
- Modal handles retries internally (if configured)
- Result is strongly typed (Python dataclass)

### Pattern 2: Database Updates

Flows update Supabase through service layer:

```python
# Update status (simple)
supabase_service.update_video_status(
    video_id=video_id,
    status="processing"
)

# Update with metadata (structured)
supabase_service.update_video_metadata(
    video_id=video_id,
    frame_count=result.frame_count,
    duration_seconds=result.duration
)
```

**Benefits:**
- Type-safe parameters
- Consistent error handling
- Easy to mock for testing

### Pattern 3: Lock Management

Flows acquire locks before modifying databases:

```python
try:
    # Non-blocking: returns False if already locked
    if not supabase_service.acquire_server_lock(video_id, "layout"):
        raise Exception("Video is being processed")

    # Critical section
    process_video()

finally:
    # Always release
    supabase_service.release_server_lock(video_id, "layout")
```

**Key Points:**
- Non-blocking acquisition
- Try/finally ensures cleanup
- Per-database granularity
- Flow controls retry strategy

### Pattern 4: Error Handling

Flows use structured error handling:

```python
try:
    # Step 1
    supabase_service.update_video_status(video_id, status="processing")

    # Step 2
    result = modal_function.remote(...)

    # Step 3
    supabase_service.update_video_status(video_id, status="active")

except Exception as e:
    # Update status on error
    supabase_service.update_video_status(
        video_id,
        status="error",
        error_message=str(e)
    )
    raise  # Re-raise for Prefect retry logic
```

**Benefits:**
- User sees error status immediately
- Prefect retry logic still applies
- Detailed error messages logged

---

## Maintenance Considerations

### Adding a New Flow

1. Define flow in `/services/api/app/flows/new_flow.py`
2. Add deployment to `prefect.yaml`, then register: `prefect deploy --all`
3. Add trigger (Realtime subscription, cron, or API endpoint)
4. Configure priority calculation
5. Test with sample data
6. Monitor in Prefect UI

### Changing Priority Logic

Priority calculation is centralized in `priority_service.py`:

```python
# Current defaults
age_boost_per_minutes=60  # +1 point per hour
age_boost_cap=20          # Max +20 points

# Can override per-request
priority = calculate_flow_priority(
    tenant_tier=tier,
    request_time=created_at,
    age_boost_per_minutes=30,  # More aggressive
    age_boost_cap=30           # Higher cap
)
```

### Scaling Workers

Currently runs 1 worker. To add more:

1. Increase worker count in `prefect_runner.py`
2. Monitor queue depth in Prefect UI
3. Consider worker specialization (separate pools for different flow types)

### Cost Optimization

**Current costs (~$0.34 per video):**
- Extract: ~$0.05 (5 min on T4)
- Crop+infer: ~$0.28 (15 min on A10G)
- OCR: ~$0.01 (30s on T4)

**Optimization strategies:**
1. Batch operations (process multiple videos in one Modal call)
2. Adjust frame rates (0.1Hz → 0.05Hz for extract)
3. Use smaller GPUs where possible
4. Cache intermediate results

---

## Related Documentation

- [Flows Reference](./flows.md) - Detailed flow specifications
- [Infrastructure](./infrastructure.md) - Fly.io deployment details
- [Modal Integration](./modal-integration.md) - Modal function contracts
- [Operations](./operations.md) - Monitoring and troubleshooting
- [Test Plan](./TEST_PLAN.md) - Testing strategy
- [Quick Start](./QUICKSTART.md) - Getting started guide
