# Prefect Orchestration Implementation Plan

## Overview

Implement the complete Prefect orchestration system as defined in `/docs/prefect-orchestration/`, using existing Prefect infrastructure and following best practices for service ownership:
- **Existing Prefect Server** - Already deployed at `https://prefect-service.fly.dev/api`
- **Three separate Modal functions** - GPU compute in `/data-pipelines/captionacc-modal/`
- **Flows in API service** - API service owns and executes orchestration flows
- **Webhook + API endpoints** - Event-driven triggers (webhooks) and user-initiated actions (API endpoints)

## Key Architecture Decisions

Based on discussion and existing infrastructure:

1. **No new Prefect server** - Reuse existing server at `https://prefect-service.fly.dev/api`
2. **Flows execute in API service** - Prefect agent runs as part of API service process (not separate service)
3. **Webhooks for automatic triggers** - Supabase → API service → triggers flows
4. **API endpoints for user actions** - Frontend → API service → triggers flows
5. **Deprecate CLI approach** - Replace subprocess-based flow queuing with direct API calls
6. **Migrate existing flows** - Reuse flows from `/services/orchestrator/` where they match documented design

## Architecture Principles

### Service Ownership & Execution

**Prefect Server (Existing on Fly.io)** - Coordination only
- URL: `https://prefect-service.fly.dev/api` (from `.env`)
- Provides: Scheduling, tracking, UI, flow run coordination
- SQLite database for flow run history
- **No application code executes here**

**API Service (`/services/api/`)** - Owns and executes flows
- **Flow definitions**: Orchestration logic in `/services/api/app/flows/`
- **Flow execution**: Prefect agent runs within API service process
- **Webhook endpoints**: Receive Supabase events, trigger flows
- **API endpoints**: User-initiated flow triggers (approve layout, request OCR)
- **Database operations**: Status updates, lock management

**Modal Functions (`/data-pipelines/captionacc-modal/`)** - GPU compute
- Three separate functions as documented
- Called remotely from API service flows
- Execute on Modal infrastructure (serverless GPU)

**Web App** - Real-time updates only
- SSE broadcaster for frontend notifications (keep as-is)
- Calls API endpoints for user actions
- No direct Prefect interaction

## Current State Analysis

### What Exists
✅ **Prefect server** - Already running at `https://prefect-service.fly.dev/api`
- Work pool: `captionacc-workers` (already configured)
- Deployed via `/services/orchestrator/` (to be deprecated as a service, but infrastructure remains)

✅ **Orchestrator service with flows** in `/services/orchestrator/flows/`
- Many existing flows that match documented design
- Reusable code: `supabase_client.py`, `wasabi_client.py`
- **Will migrate flows to API service, then remove orchestrator service**

✅ **Modal infrastructure** in `/data-pipelines/caption_frame_extents/`
- Integrated batch function: `run_caption_frame_extents_inference_batch()`
- Working A10G GPU deployment with model volume
- **Will split into 3 separate functions as documented**

✅ **TypeScript SSE broadcaster** in `apps/captionacc-web/app/routes/api.webhooks.prefect.tsx`
- Broadcasts flow status to frontend
- **Keep as-is for real-time UI updates**

### What Needs Implementation

❌ **Split Modal functions** - Create 3 separate functions matching doc specifications
❌ **Migrate flows to API service** - Move from orchestrator to API service
❌ **Add Prefect agent to API service** - Enable flow execution in API process
❌ **Webhook endpoints in API service** - Handle Supabase events, trigger flows
❌ **API endpoints for user actions** - Approve layout, request OCR endpoints
❌ **Create Prefect API key** - For API service authentication to Prefect server
❌ **Register flows** - Deploy migrated flows to existing Prefect server
❌ **Configure Supabase webhooks** - Point to API service webhook endpoints

## Architecture Alignment

### Documentation vs Current Implementation

| Component | Documented | Current | Action Required |
|-----------|-----------|---------|-----------------|
| Modal: extract_frames_and_ocr | Separate T4 function | Integrated in batch function | **Split out** |
| Modal: crop_and_infer_caption_frame_extents | Separate A10G function | Integrated in batch function | **Split out** |
| Modal: generate_caption_ocr | Separate T4 function | Integrated in batch function | **Split out** |
| Flow: video-initial-processing | Supabase webhook trigger | Exists in orchestrator | **Migrate to API service** |
| Flow: crop-and-infer | API call trigger | `crop_frames_to_webm` exists | **Migrate & update to call Modal** |
| Flow: caption-ocr | API call trigger | `caption_median_ocr` exists | **Migrate & update to call Modal** |
| Webhook handler | API service endpoint | None | **Create in API service** |
| Flow execution | API service (Prefect agent) | Orchestrator service | **Add agent to API service** |
| Trigger mechanism | Webhooks + API endpoints | CLI subprocess calls | **Replace with direct triggers** |

## Implementation Plan

### Phase 1: Modal Function Refactoring

**Location:** `/data-pipelines/captionacc-modal/` (new package)

Create three separate Modal functions matching doc specifications:

#### 1.1 extract_frames_and_ocr
```python
@app.function(
    gpu="T4",
    timeout=1800,  # 30 minutes
    secrets=[modal.Secret.from_name("wasabi"), modal.Secret.from_name("google-vision")]
)
def extract_frames_and_ocr(
    video_key: str,
    tenant_id: str,
    video_id: str,
    frame_rate: float = 0.1
) -> ExtractResult
```

**Operations:**
- Download video from Wasabi
- Extract frames at 0.1Hz using FFmpeg
- Run Google Vision OCR on each frame
- Create `raw-ocr.db.gz` with full OCR results
- Create `layout.db.gz` with box positions
- Upload frames to `{tenant}/client/videos/{id}/full_frames/*.jpg`
- Upload databases to Wasabi

#### 1.2 crop_and_infer_caption_frame_extents
```python
@app.function(
    gpu="A10G",
    timeout=3600,  # 60 minutes
    secrets=[modal.Secret.from_name("wasabi")]
)
def crop_and_infer_caption_frame_extents(
    video_key: str,
    tenant_id: str,
    video_id: str,
    crop_region: CropRegion,
    frame_rate: float = 10.0
) -> CropInferResult
```

**Operations:**
- Download video and layout.db from Wasabi
- Crop and extract frames at 10Hz
- Encode as VP9 WebM chunks (modulo hierarchy: 16, 4, 1)
- Run caption frame extents inference model on frame pairs
- Create `caption_frame_extents.db`
- Upload chunks and DB to Wasabi

#### 1.3 generate_caption_ocr
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
) -> CaptionOcrResult
```

**Operations:**
- Download WebM chunks from Wasabi
- Extract frames in range
- Compute per-pixel median across frames
- Run Google Vision OCR on median frame
- Return OCR text and confidence

**Files to create:**
- `/data-pipelines/captionacc-modal/src/captionacc_modal/app.py` - Modal app setup
- `/data-pipelines/captionacc-modal/src/captionacc_modal/extract.py` - Function 1
- `/data-pipelines/captionacc-modal/src/captionacc_modal/inference.py` - Function 2
- `/data-pipelines/captionacc-modal/src/captionacc_modal/ocr.py` - Function 3
- `/data-pipelines/captionacc-modal/pyproject.toml` - Package config

**Reuse existing code:**
- Frame extraction logic from `/data-pipelines/crop_frames/`
- OCR logic from `/data-pipelines/full_frames/`
- Inference logic from `/data-pipelines/caption_frame_extents/`

---

### Phase 2: Prefect Flow Implementation

**Location:** `/services/api/app/flows/` (new directory in API service)

#### 2.1 captionacc_video_initial_processing.py

```python
@flow(name="captionacc-video-initial-processing")
def captionacc_video_initial_processing(
    video_id: str,
    tenant_id: str,
    storage_key: str
):
    # 1. Update status to 'processing'
    update_video_status(video_id, status="processing")

    # 2. Call Modal extract_frames_and_ocr
    result = modal_extract_frames_and_ocr.remote(
        video_key=storage_key,
        tenant_id=tenant_id,
        video_id=video_id,
        frame_rate=0.1,
    )

    # 3. Update Supabase with results
    update_video_metadata(
        video_id=video_id,
        frame_count=result.frame_count,
        duration_seconds=result.duration,
        status="active"
    )
```

**Trigger:** Supabase database webhook on `videos` table INSERT

#### 2.2 captionacc_crop_and_infer_caption_frame_extents.py

```python
@flow(name="captionacc-crop-and-infer-caption-frame-extents")
def captionacc_crop_and_infer_caption_frame_extents(
    video_id: str,
    tenant_id: str,
    crop_region: dict
):
    # 1. Acquire server lock on layout database
    acquire_server_lock(video_id, database_name="layout")

    try:
        # 2. Call Modal crop_and_infer
        modal_result = modal_crop_and_infer.remote(
            video_key=f"{tenant_id}/client/videos/{video_id}/video.mp4",
            tenant_id=tenant_id,
            video_id=video_id,
            crop_region=crop_region,
            frame_rate=10.0,
        )

        # 3. Call API to process inference results
        api_process_inference(
            video_id=video_id,
            caption_frame_extents_results_key=modal_result.db_key,
            cropped_frames_version=modal_result.version
        )

        # 4. Update Supabase
        update_video_status(video_id, caption_status="ready")

    finally:
        # 5. Release server lock
        release_server_lock(video_id)
```

**Trigger:** API call when user approves layout

#### 2.3 captionacc_caption_ocr.py

```python
@flow(name="captionacc-caption-ocr")
def captionacc_caption_ocr(
    tenant_id: str,
    video_id: str,
    caption_id: int,
    start_frame: int,
    end_frame: int,
    version: int
):
    # 1. Update caption status
    update_caption_ocr_status(video_id, caption_id, status="processing")

    try:
        # 2. Call Modal caption OCR
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

    except Exception as e:
        update_caption_ocr_status(video_id, caption_id, status="error")
        raise
```

**Trigger:** API call when user requests caption OCR

**Files to create/update:**
- `/services/api/app/flows/captionacc_video_initial_processing.py` - NEW
- `/services/api/app/flows/captionacc_crop_and_infer.py` - NEW (combine existing logic)
- `/services/api/app/flows/captionacc_caption_ocr.py` - NEW
- `/services/api/app/flows/__init__.py` - NEW (export all flows)

**Reuse code from deprecated orchestrator:**
- Extract Supabase client logic from `/services/orchestrator/supabase_client.py`
- Extract Wasabi client logic from `/services/orchestrator/wasabi_client.py`
- Place in `/services/api/app/services/` directory

---

### Phase 3: Priority Service & Flow Triggering

**Location:** `/services/api/app/services/` and `/services/api/app/routers/`

#### 3.1 Priority Service (NEW)

Create a priority calculation service with flexible, dynamic prioritization:

```python
# /services/api/app/services/priority_service.py (NEW)
"""
Dynamic priority calculation for Prefect flow runs.
Priority range: 0-100 (higher = more urgent)
Age-based boosting is enabled by default to prevent starvation.
"""
from datetime import datetime
from enum import IntEnum

class TenantTier(IntEnum):
    """Base priority by tenant tier"""
    FREE = 50
    PREMIUM = 70
    ENTERPRISE = 90

def calculate_flow_priority(
    tenant_tier: str,
    request_time: datetime | None = None,
    video_size_bytes: int | None = None,
    enable_age_boosting: bool = True,
    base_priority_override: int | None = None
) -> int:
    """
    Calculate dynamic priority for flow execution.

    Args:
        tenant_tier: Tenant tier (free, premium, enterprise)
        request_time: When the request was created (for age-based boosting)
        video_size_bytes: Video file size (smaller videos get slight boost)
        enable_age_boosting: Enable age-based priority boost (default: True)
        base_priority_override: Override base priority from tier (useful for testing)

    Returns:
        Priority value (0-100, higher = more urgent)

    Examples:
        # Standard usage (age boosting enabled)
        priority = calculate_flow_priority("premium", datetime.now())

        # Disable age boosting for batch jobs
        priority = calculate_flow_priority("free", datetime.now(), enable_age_boosting=False)

        # Override base priority for testing
        priority = calculate_flow_priority("free", enable_age_boosting=False, base_priority_override=10)
    """
    # Base priority from tier (or override)
    if base_priority_override is not None:
        priority = base_priority_override
    else:
        priority = TenantTier[tenant_tier.upper()].value

    # Age-based boost (default enabled, prevents starvation)
    if enable_age_boosting and request_time:
        age_hours = (datetime.now() - request_time).total_seconds() / 3600
        age_boost = min(age_hours * 2, 20)  # Cap at +20
        priority += age_boost

    # Small video boost (processes faster, less resource blocking)
    if video_size_bytes and video_size_bytes < 50_000_000:  # < 50MB
        priority += 5

    return int(min(priority, 100))  # Cap at 100
```

**Why this design:**
- **Default age boosting**: Prevents old requests from being starved by newer ones
- **Optional disable**: Batch jobs, non-urgent operations, or testing can disable it
- **Flexible**: Easy to add more factors (user SLA, system load, business rules)
- **Simple**: Single function, no external dependencies

#### 3.2 Webhook Handler (FastAPI)

Add webhook router to API service:

```python
# /services/api/app/routers/webhooks.py (NEW)
from fastapi import APIRouter, Request, HTTPException, Depends
from prefect import get_client
from datetime import datetime
from ..flows import captionacc_video_initial_processing
from ..services.priority_service import calculate_flow_priority

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")

@router.post("/supabase/videos")
async def handle_video_insert_webhook(request: Request):
    """
    Handle Supabase webhook for video table inserts.
    Triggers captionacc-video-initial-processing flow with dynamic priority.
    """
    # Verify webhook secret
    auth = request.headers.get("Authorization", "")
    if not WEBHOOK_SECRET or auth != f"Bearer {WEBHOOK_SECRET}":
        raise HTTPException(401, "Unauthorized")

    payload = await request.json()

    # Validate payload
    if payload.get("type") != "INSERT" or payload.get("table") != "videos":
        return {"status": "ignored", "reason": "not a video insert"}

    record = payload["record"]

    # Get tenant info for priority calculation
    # TODO: Fetch tenant tier from Supabase
    tenant_tier = "premium"  # Placeholder

    # Calculate priority (age boosting enabled by default)
    # Default: +1 point per 60 minutes, capped at 20 points
    priority = calculate_flow_priority(
        tenant_tier=tenant_tier,
        request_time=datetime.now(),  # Video just uploaded
        enable_age_boosting=True,  # Default
        age_boost_per_minutes=60,  # +1 point per hour
        age_boost_cap=20  # Max +20 points
    )

    # Trigger Prefect flow with priority
    async with get_client() as client:
        deployment = await client.read_deployment_by_name(
            "captionacc-video-initial-processing/production"
        )
        flow_run = await client.create_flow_run_from_deployment(
            deployment.id,
            parameters={
                "video_id": record["id"],
                "tenant_id": record["tenant_id"],
                "storage_key": record["storage_key"]
            },
            priority=priority,
            tags=[
                f"tenant:{record['tenant_id']}",
                f"tier:{tenant_tier}",
                f"priority:{priority}"
            ]
        )

    return {
        "status": "accepted",
        "flow_run_id": flow_run.id,
        "video_id": record["id"],
        "priority": priority
    }
```

#### 3.3 API Endpoints for Flow Triggering

Add endpoints for user-initiated flows with priority support:

```python
# /services/api/app/routers/videos.py (UPDATE existing)
from datetime import datetime
from ..services.priority_service import calculate_flow_priority

@router.post("/{video_id}/approve-layout")
async def approve_layout(
    video_id: str,
    crop_region: CropRegion,
    auth: Auth,
    disable_age_boosting: bool = False  # Optional: disable age boosting
):
    """
    Approve layout and trigger crop+infer flow.
    User-blocking operation, so uses higher base priority.
    """
    # Get video metadata for priority calculation
    # TODO: Fetch video creation time and tenant tier from Supabase
    video_created_at = datetime.now()  # Placeholder
    tenant_tier = "premium"  # Placeholder

    # Calculate priority
    priority = calculate_flow_priority(
        tenant_tier=tenant_tier,
        request_time=video_created_at,
        enable_age_boosting=not disable_age_boosting  # Respect override
    )

    # Trigger Prefect flow
    async with get_client() as client:
        deployment = await client.read_deployment_by_name(
            "captionacc-crop-and-infer-caption-frame-extents/production"
        )
        flow_run = await client.create_flow_run_from_deployment(
            deployment.id,
            parameters={
                "video_id": video_id,
                "tenant_id": auth.tenant_id,
                "crop_region": crop_region.model_dump()
            },
            priority=priority,
            tags=[
                f"tenant:{auth.tenant_id}",
                f"tier:{tenant_tier}",
                f"priority:{priority}",
                "user-initiated"
            ]
        )

    return {
        "flow_run_id": flow_run.id,
        "status": "queued",
        "priority": priority
    }

@router.post("/{video_id}/captions/{caption_id}/request-ocr")
async def request_caption_ocr(
    video_id: str,
    caption_id: int,
    auth: Auth,
    disable_age_boosting: bool = False  # Optional: disable age boosting
):
    """
    Request OCR for a caption.
    Fast operation, lower resource usage.
    """
    # Get caption details from captions.db
    # ... fetch start_frame, end_frame, version

    # Get tenant info
    tenant_tier = "premium"  # Placeholder

    # Calculate priority (slightly higher for interactive requests)
    priority = calculate_flow_priority(
        tenant_tier=tenant_tier,
        request_time=datetime.now(),  # Just requested
        enable_age_boosting=not disable_age_boosting
    )

    # Trigger Prefect flow
    async with get_client() as client:
        deployment = await client.read_deployment_by_name(
            "captionacc-caption-ocr/production"
        )
        flow_run = await client.create_flow_run_from_deployment(
            deployment.id,
            parameters={
                "tenant_id": auth.tenant_id,
                "video_id": video_id,
                "caption_id": caption_id,
                "start_frame": start_frame,
                "end_frame": end_frame,
                "version": version
            },
            priority=priority,
            tags=[
                f"tenant:{auth.tenant_id}",
                f"caption:{caption_id}",
                f"priority:{priority}"
            ]
        )

    return {
        "flow_run_id": flow_run.id,
        "status": "queued",
        "priority": priority
    }
```

**Usage Examples:**

```python
# Standard request (age boosting enabled by default)
POST /videos/{video_id}/approve-layout
{
    "crop_region": {...}
}

# Disable age boosting for batch processing or testing
POST /videos/{video_id}/approve-layout?disable_age_boosting=true
{
    "crop_region": {...}
}
```

**Files to create/update:**
- `/services/api/app/services/priority_service.py` - NEW: Priority calculation with flexible age boosting
- `/services/api/app/routers/webhooks.py` - NEW: Webhook router with priority support
- `/services/api/app/routers/videos.py` - UPDATE: Flow trigger endpoints with priority support
- `/services/api/app/main.py` - UPDATE: Include webhook router

**Priority Flexibility:**
- **Default behavior**: Age boosting enabled (prevents starvation)
- **Per-request override**: Pass `disable_age_boosting=True` to disable
- **Use cases for disabling**:
  - Batch processing jobs (no urgency)
  - Testing/debugging (predictable priority)
  - Low-priority maintenance tasks
  - Cost optimization (delay non-critical work)

**Note:** Keep TypeScript SSE broadcaster in web app for real-time UI updates (separate concern)

---

### Phase 4: API Service Integration with Prefect

**Goal:** Enable API service to execute flows and communicate with existing Prefect server at `https://prefect-service.fly.dev/api`

#### 4.1 Add Prefect Agent to API Service

The API service needs to run a Prefect agent to execute flows:

```python
# /services/api/app/prefect_agent.py (NEW)
"""
Prefect agent runs alongside FastAPI server.
Polls Prefect server for flow runs and executes them in API service process.
"""
import asyncio
from prefect.runner import Runner
import os

PREFECT_API_URL = os.getenv("PREFECT_API_URL", "https://prefect-service.fly.dev/api")
PREFECT_API_KEY = os.getenv("PREFECT_API_KEY")  # Create in step 4.2

async def start_prefect_agent():
    """Start Prefect agent to execute flows in this process."""

    runner = Runner(
        name="api-service-agent",
        work_pool_name="captionacc-workers",
        limit=2,  # Max 2 concurrent flows
    )

    # Start runner (non-blocking)
    await runner.start()
    return runner

# Integrate with FastAPI lifespan
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start Prefect agent
    agent = await start_prefect_agent()

    yield  # Server runs

    # Shutdown: Stop agent
    await agent.stop()
```

Update FastAPI app:

```python
# /services/api/app/main.py (UPDATE)
from app.prefect_agent import lifespan

app = FastAPI(lifespan=lifespan)
```

#### 4.2 Create Prefect API Key

Create API key for API service authentication:

```bash
# Connect to existing Prefect server
export PREFECT_API_URL="https://prefect-service.fly.dev/api"

# Create API key (if server supports it - not all self-hosted servers need keys, if not investigate security and best practices for self-hosting Prefect on Fly.io)
prefect cloud api-key create "api-service" --role admin

# Or set in environment without key if server doesn't require authentication
# Just set PREFECT_API_URL, omit PREFECT_API_KEY
```

#### 4.3 Register Flows with Prefect Server

```bash
# /services/api/scripts/register_flows.sh (NEW)
#!/bin/bash
set -e

export PREFECT_API_URL="https://prefect-service.fly.dev/api"

echo "Registering flows with Prefect server..."

cd services/api

# Register video initial processing flow
prefect deploy \
  app/flows/video_initial_processing.py:captionacc_video_initial_processing \
  --name production \
  --work-pool captionacc-workers \
  --cron ""  # No schedule, webhook-triggered

# Register crop and infer flow
prefect deploy \
  app/flows/crop_and_infer.py:captionacc_crop_and_infer_caption_frame_extents \
  --name production \
  --work-pool captionacc-workers

# Register caption OCR flow
prefect deploy \
  app/flows/caption_ocr.py:captionacc_caption_ocr \
  --name production \
  --work-pool captionacc-workers

echo "✅ All flows registered!"
echo "View at: https://prefect-service.fly.dev"
```

#### 4.4 Update API Service Configuration

```python
# /services/api/app/config.py (UPDATE)
class Settings(BaseSettings):
    # Existing settings...

    # Prefect configuration
    prefect_api_url: str = "https://prefect-service.fly.dev/api"
    prefect_api_key: str | None = None  # See note about about security
    prefect_work_pool: str = "captionacc-workers"
```

**Files to create/update:**
- `/services/api/app/prefect_agent.py` - NEW: Prefect agent integration
- `/services/api/app/main.py` - UPDATE: Add lifespan with agent
- `/services/api/app/config.py` - UPDATE: Add Prefect config
- `/services/api/scripts/register_flows.sh` - NEW: Flow registration
- `/services/api/.env` - UPDATE: Add `PREFECT_API_URL` (already exists)

---

### Phase 5: Supabase Webhook Configuration

#### 5.1 Webhook Configuration

**Target URL:** API service (NOT Prefect server)
- URL: `https://api.captionacc.com/webhooks/supabase/videos` (or equivalent API service URL)
- The API service handles webhooks and triggers Prefect flows internally

**Manual Configuration:**
1. Supabase Dashboard → Database → Webhooks
2. Create webhook for `videos` table INSERT
3. URL: `https://api.captionacc.com/webhooks/supabase/videos`
4. Headers: `Authorization: Bearer {WEBHOOK_SECRET}`

---

### Phase 6: Integration & Testing

#### 6.1 Environment Variables

**API Service (.env):**
```bash
# Prefect configuration (agent runs in API service)
PREFECT_API_URL=xxx  # Already in .env
PREFECT_API_KEY=xxx  # Optional, if Prefect server requires auth

# Modal configuration
MODAL_TOKEN_ID=xxx
MODAL_TOKEN_SECRET=xxx

# Supabase configuration
SUPABASE_URL=xxx  # Already in .env
SUPABASE_SERVICE_KEY=xxx  # Already in .env

# Wasabi configuration
WASABI_ACCESS_KEY=xxx  # Already in .env
WASABI_SECRET_KEY=xxx  # Already in .env
WASABI_BUCKET=caption-acc-prod  # Already in .env

# Webhook secret
WEBHOOK_SECRET=xxx  # For Supabase webhook verification
```

**Web App (.env):**
```bash
# No Prefect configuration needed
# Flow triggering happens via API service endpoints
# Web app only receives SSE updates for real-time UI
```

#### 6.2 Testing Strategy

**Unit Tests:**
- Test each Modal function independently with test data
- Test flow logic with mocked Modal calls
- Test webhook handler with sample payloads

**Integration Tests:**
1. Upload test video → verify initial processing flow triggered
2. Approve layout → verify crop+infer flow triggered
3. Request caption OCR → verify OCR flow triggered
4. Monitor Prefect UI for flow runs
5. Verify Supabase status updates
6. Verify Wasabi uploads

**Local Testing:**
```bash
# 1. Ensure Prefect server is accessible
export PREFECT_API_URL=xxx

# 2. Register flows with Prefect server
cd services/api
./scripts/register_flows.sh

# 3. Start API service (agent runs automatically via lifespan)
cd services/api
uvicorn app.main:app --reload --port 8000
# The Prefect agent starts automatically when FastAPI starts

# 4. Test webhook
curl -X POST http://localhost:8000/webhooks/supabase/videos \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"type":"INSERT","table":"videos","record":{"id":"uuid","tenant_id":"uuid","storage_key":"tenant/video.mp4"}}'

# 5. Check Prefect UI for flow runs
open https://prefect-service.fly.dev
```

---

## Critical Files to Modify/Create

### New Files (Modal)
- `/data-pipelines/captionacc-modal/src/captionacc_modal/app.py` - Modal app setup
- `/data-pipelines/captionacc-modal/src/captionacc_modal/extract.py` - extract_frames_and_ocr function
- `/data-pipelines/captionacc-modal/src/captionacc_modal/inference.py` - crop_and_infer function
- `/data-pipelines/captionacc-modal/src/captionacc_modal/ocr.py` - generate_caption_ocr function
- `/data-pipelines/captionacc-modal/src/captionacc_modal/models.py` - Dataclasses for return types
- `/data-pipelines/captionacc-modal/pyproject.toml` - Package config

### New Files (API Flows)
- `/services/api/app/flows/__init__.py` - Export all flows
- `/services/api/app/flows/captionacc_video_initial_processing.py` - Video initial processing flow
- `/services/api/app/flows/captionacc_crop_and_infer.py` - Crop and infer flow
- `/services/api/app/flows/captionacc_caption_ocr.py` - Caption OCR flow

### New Files (API Services)
- `/services/api/app/services/priority_service.py` - Dynamic priority calculation with flexible age boosting
- `/services/api/app/services/supabase_service.py` - Supabase client & repositories (extract from orchestrator)
- `/services/api/app/services/wasabi_service.py` - Wasabi S3 client (extract from orchestrator)
- `/services/api/app/services/modal_service.py` - Modal function wrappers

### New Files (API Routers)
- `/services/api/app/routers/webhooks.py` - Supabase webhook handlers

### Update Files (API)
- `/services/api/app/routers/videos.py` - Add approve-layout and request-ocr endpoints
- `/services/api/app/main.py` - Include webhook router
- `/services/api/app/config.py` - Add Prefect API URL config

### New Files (API Prefect Integration)
- `/services/api/app/prefect_agent.py` - Prefect agent that runs in API service
- `/services/api/scripts/register_flows.sh` - Register flows with existing Prefect server

### Keep as-is (Web App)
- `apps/captionacc-web/app/routes/api.webhooks.prefect.tsx` - SSE broadcaster for frontend (keep for UI updates)
- `apps/captionacc-web/app/services/sse-broadcaster.ts` - Real-time UI updates

### Keep as-is (Infrastructure)
- Prefect server at `https://prefect-service.fly.dev/api` - Already deployed and running
- Work pool `captionacc-workers` - Already configured

### Deprecate & Remove
- `apps/captionacc-web/app/services/prefect.ts` - Remove TypeScript flow queuing client
- `/services/orchestrator/` - Entire orchestrator service (extract reusable code first, then delete)

---

## Verification Checklist

After implementation, verify:

- [ ] Modal functions deployed and callable independently
- [ ] Prefect server accessible at `https://prefect-service.fly.dev/api`
- [ ] Prefect agent running in API service process
- [ ] Three flows registered with Prefect server
- [ ] Supabase webhook configured and firing to API service
- [ ] Video upload triggers initial processing flow
- [ ] Layout approval triggers crop+infer flow
- [ ] Caption OCR request triggers OCR flow
- [ ] Flows execute in API service (check logs)
- [ ] Status updates visible in Supabase
- [ ] Files uploaded to Wasabi correctly
- [ ] Frontend receives SSE updates
- [ ] Monitoring dashboard accessible (Prefect UI)
- [ ] Error handling and retries working

---

## Migration Strategy

1. **Create new Modal package** alongside existing implementations
2. **Test Modal functions independently** before integration
3. **Extract reusable code** from orchestrator service (Supabase/Wasabi clients → API service)
4. **Migrate flows to API service** one at a time, test in isolation
5. **Add Prefect agent to API service** (runs alongside FastAPI)
6. **Register flows** with existing Prefect server
7. **Create webhook endpoints** in API service
8. **Configure Supabase webhooks** to point to API service
9. **Deprecate orchestrator service** after full verification
10. **Remove TypeScript Prefect client** and CLI approach

**Key principle:** Maintain backward compatibility during transition. Old orchestrator can run alongside new implementation until fully verified.

---

## Estimated Implementation Order

1. **Modal functions** (Day 1-2) - Split into 3 separate functions, test independently
2. **Extract orchestrator code** (Day 2) - Move Supabase/Wasabi clients to API service
3. **Migrate flows to API service** (Day 2-3) - Copy flows, update to call Modal
4. **Add Prefect agent** (Day 3) - Integrate agent into API service lifespan
5. **Webhook + API endpoints** (Day 3) - Trigger mechanisms
6. **Register flows** (Day 3) - Deploy to existing Prefect server
7. **Integration testing** (Day 4) - End-to-end verification
8. **Deprecate orchestrator** (Day 4) - Remove old service after verification

---

## Risk Mitigation

**Risk:** Modal function failures
**Mitigation:** Implement retries, timeouts, and fallback error handling

**Risk:** Webhook cold start delays (API service may sleep on Fly.io)
**Mitigation:** Configure warmup health checks, increase timeout in Supabase webhook

**Risk:** Flow concurrency limits
**Mitigation:** Configure work pool limits, implement queue prioritization

**Risk:** Cost overruns from GPU usage
**Mitigation:** Set max timeout limits, implement cost estimation artifacts

**Risk:** Data inconsistency during migration
**Mitigation:** Run old and new systems in parallel, verify outputs match
