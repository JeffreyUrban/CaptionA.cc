# Quick Start Guide

Get the Prefect orchestration system running in your development environment.

## Prerequisites

- Python 3.11+
- Modal account with API token configured (`modal token list`)
- Prefect server running at `https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api`
- Environment variables configured (see below)

## Environment Setup

Create `/services/api/.env` with required variables:

```bash
# Prefect (already configured)
PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api

# Supabase (verify these are set)
SUPABASE_URL=https://stbnsczvywpwjzbpfehp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Wasabi (verify these are set)
WASABI_ACCESS_KEY_READWRITE=your-access-key
WASABI_SECRET_KEY_READWRITE=your-secret-key
WASABI_BUCKET=captionacc-prod
```

## Installation

```bash
# Install API service dependencies
cd services/api
pip install -e .

# Install Modal dependencies
cd ../../data-pipelines/captionacc-modal
pip install -e .
```

## Deploy Modal Functions

```bash
cd data-pipelines/captionacc-modal

# Deploy all three functions
modal deploy src/captionacc_modal/extract.py
modal deploy src/captionacc_modal/inference.py
modal deploy src/captionacc_modal/ocr.py

# Verify deployment
modal app list
# Should show: captionacc-modal with 3 functions
```

## Register Flows with Prefect

Flow deployments are registered using the `prefect deploy` CLI with `prefect.yaml`:

```bash
cd services/api

# Set Prefect API URL
export PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api

# Register all flows defined in prefect.yaml
prefect deploy --all
```

This registers the deployments defined in `services/api/prefect.yaml`. In production, this runs automatically when deploying the API service to Fly.io (`fly deploy` in `services/api`), via the release command configured in `fly.toml`.

## Start API Service

```bash
cd services/api

# Start API with Prefect worker (runs automatically)
uvicorn app.main:app --reload --port 8000
```

Verify in logs:
```
INFO - Starting API service in development mode
INFO - Starting Prefect worker for work pool 'captionacc-workers'
INFO - Successfully connected to Prefect server
INFO - Loaded flows: caption_ocr, crop_and_infer, video_initial_processing
INFO - Prefect worker started successfully
```

## Test the System

### Test Process New Videos Trigger

The API service automatically subscribes to Supabase Realtime for video INSERT events.
You can also manually trigger processing via the internal endpoint:

```bash
curl -X POST http://localhost:8000/internal/process-new-videos/trigger \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "flow_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "triggered"
}
```

### Monitor Flow Execution

1. **Prefect UI:** Visit https://banchelabs-gateway.fly.dev
2. **Flow Runs:** Check the latest flow run
3. **Logs:** View execution logs and status

## Video Processing Trigger

Video processing is triggered automatically via two mechanisms:

1. **Primary (immediate):** Supabase Realtime subscription on `videos` table INSERT
   - The API subscribes when it starts
   - Processing starts immediately when a video is uploaded

2. **Recovery (every 15 min):** Cron job catches any missed events
   - Runs via Supercronic inside the API container
   - Queries for videos with `layout_status = 'wait'`

No manual configuration is needed - this works automatically in both dev and prod.

## Troubleshooting

### Worker Not Starting

```bash
# Check Prefect API URL is set
echo $PREFECT_API_URL

# If not set, add to .env
echo "PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api" >> services/api/.env

# Restart API service
```

### Realtime Subscription Not Connecting

Check the API logs for Realtime subscription status:
```
INFO - Realtime subscriber started for schema captionacc_prod
INFO - Subscribed to captionacc_prod.videos INSERT events
```

If not connecting, verify Supabase credentials in `.env`:
```bash
grep SUPABASE_URL services/api/.env
grep SUPABASE_SERVICE_ROLE_KEY services/api/.env
```

### Modal Function Not Found

```bash
# Verify Modal functions are deployed
modal app list

# Redeploy if needed
cd data-pipelines/captionacc-modal
modal deploy src/captionacc_modal/extract.py
```

### Flow Stuck in "Scheduled"

```bash
# Check worker is running
ps aux | grep "prefect worker"

# Check API logs for worker output
# Look for: "[Worker] ..." log lines

# Restart API service if worker crashed
```

## Next Steps

- Read [Architecture & Design](./ARCHITECTURE.md) for system design details
- Review [Flows Reference](./flows.md) for flow specifications
- Check [Operations Guide](./operations.md) for monitoring and maintenance
- See [Test Plan](./TEST_PLAN.md) for testing strategies

## Quick Reference

```bash
# Start API service with worker
cd services/api && uvicorn app.main:app --reload --port 8000

# Trigger video processing manually
curl -X POST http://localhost:8000/internal/process-new-videos/trigger

# Check Prefect deployments
export PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api
prefect deployment ls

# View flow runs
prefect flow-run ls --limit 10

# Check Modal apps
modal app list

# Re-register flows
cd services/api && prefect deploy --all
```
