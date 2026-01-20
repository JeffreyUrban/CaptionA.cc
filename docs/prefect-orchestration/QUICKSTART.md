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
# Webhook Authentication
WEBHOOK_SECRET=your-random-secret-key-here

# Prefect (already configured)
PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api

# Supabase (verify these are set)
SUPABASE_URL=https://stbnsczvywpwjzbpfehp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Wasabi (verify these are set)
WASABI_ACCESS_KEY_READWRITE=your-access-key
WASABI_SECRET_KEY_READWRITE=your-secret-key
WASABI_BUCKET=caption-acc-prod
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

### Test Webhook Endpoint

```bash
export WEBHOOK_SECRET="your-random-secret-key-here"  # pragma: allowlist secret

curl -X POST http://localhost:8000/webhooks/supabase/videos \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "INSERT",
    "table": "videos",
    "record": {
      "id": "test-video-123",
      "tenant_id": "test-tenant-456",
      "storage_key": "test-tenant-456/client/videos/test-video-123/video.mp4",
      "created_at": "2024-01-12T00:00:00Z"
    }
  }'
```

Expected response:
```json
{
  "success": true,
  "flow_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted",
  "message": "Flow run created with priority 70"
}
```

### Monitor Flow Execution

1. **Prefect UI:** Visit https://banchelabs-gateway.fly.dev
2. **Flow Runs:** Check the latest flow run
3. **Logs:** View execution logs and status

## Configure Supabase Webhook

Once testing is complete, configure the webhook in Supabase:

1. Go to Supabase Dashboard → Database → Webhooks
2. Create new webhook:
   - **Name:** prefect-video-processing
   - **URL:** `http://localhost:8000/webhooks/supabase/videos` (for local testing)
   - **Method:** POST
   - **Headers:** `Authorization: Bearer {your-webhook-secret}`
   - **Events:** INSERT
   - **Table:** videos
   - **Schema:** captionacc_production

## Troubleshooting

### Worker Not Starting

```bash
# Check Prefect API URL is set
echo $PREFECT_API_URL

# If not set, add to .env
echo "PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api" >> services/api/.env

# Restart API service
```

### Webhook Returns 401

```bash
# Verify webhook secret matches
grep WEBHOOK_SECRET services/api/.env

# Ensure curl uses the same secret
export WEBHOOK_SECRET="same-value-as-in-env"  # pragma: allowlist secret
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

# Test webhook
curl -X POST http://localhost:8000/webhooks/supabase/videos \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"type":"INSERT","table":"videos","record":{"id":"test","tenant_id":"test","storage_key":"test.mp4","created_at":"2024-01-12T00:00:00Z"}}'

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
