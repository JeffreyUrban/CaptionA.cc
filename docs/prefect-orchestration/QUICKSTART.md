# Prefect Orchestration - Quick Start Guide

**Get the system running in 15 minutes**

---

## Prerequisites

- [ ] Python 3.11+ installed
- [ ] Modal account with API token configured
- [ ] Prefect server running at https://prefect-service.fly.dev/api
- [ ] Supabase database access
- [ ] Wasabi S3 credentials
- [ ] Google Vision API credentials

---

## Step 1: Environment Setup (2 minutes)

### Configure API Service

```bash
cd /Users/jurban/PycharmProjects/CaptionA.cc-claude1/services/api

# Create/update .env file
cat >> .env << 'EOF'

# Webhook Secret (generate a random string)
WEBHOOK_SECRET=your-random-secret-key-here

# Prefect (already configured)
PREFECT_API_URL=https://prefect-service.fly.dev/api

# These should already be set, verify:
SUPABASE_URL=https://stbnsczvywpwjzbpfehp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_uUzm92wuXmVT4rW7wixIkw_KgMauN6O
WASABI_ACCESS_KEY_READWRITE=7YM79I60WEISWCDC8E7X
WASABI_SECRET_KEY_READWRITE=Y5UnBDSPVOn012MbtGViDYwsvvhZaor3AOPQz8Ry
WASABI_BUCKET=caption-acc-prod
EOF
```

### Install Dependencies

```bash
# API service dependencies
cd services/api
pip install -e .

# Modal dependencies
cd ../../data-pipelines/captionacc-modal
pip install -e .
```

---

## Step 2: Deploy Modal Functions (3 minutes)

```bash
cd /Users/jurban/PycharmProjects/CaptionA.cc-claude1/data-pipelines/captionacc-modal

# Verify Modal is configured
modal token list

# Deploy all three functions
modal deploy src/captionacc_modal/extract.py
modal deploy src/captionacc_modal/inference.py
modal deploy src/captionacc_modal/ocr.py
```

**Verify deployment:**
```bash
modal app list
# Should show: captionacc-modal with 3 functions
```

---

## Step 3: Register Flows with Prefect (2 minutes)

```bash
cd /Users/jurban/PycharmProjects/CaptionA.cc-claude1/services/api

# Set Prefect API URL
export PREFECT_API_URL=https://prefect-service.fly.dev/api

# Make script executable (if not already)
chmod +x scripts/register_flows.sh

# Register all flows
./scripts/register_flows.sh
```

**Expected output:**
```
✓ Checking Prefect installation...
✓ Connecting to Prefect server...
✓ Checking work pool 'captionacc-workers'...

Registering flows...
✓ captionacc-video-initial-processing
✓ captionacc-crop-and-infer-caption-frame-extents
✓ captionacc-caption-ocr

Summary: 3 flows registered successfully
```

**Verify in Prefect UI:**
- Visit: https://prefect-service.fly.dev
- Navigate to Deployments
- Should see 3 deployments with "production" name

---

## Step 4: Start API Service (1 minute)

```bash
cd /Users/jurban/PycharmProjects/CaptionA.cc-claude1/services/api

# Start API with Prefect worker
uvicorn app.main:app --reload --port 8000
```

**Verify in logs:**
```
INFO - Starting API service in development mode
INFO - Starting Prefect worker for work pool 'captionacc-workers'
INFO - Successfully connected to Prefect server
INFO - Loaded flows: caption_ocr, crop_and_infer, video_initial_processing
INFO - Prefect worker started successfully
```

**Keep this terminal open** - worker needs to stay running.

---

## Step 5: Test Webhook Endpoint (2 minutes)

Open a new terminal:

```bash
# Set your webhook secret
export WEBHOOK_SECRET="your-random-secret-key-here"

# Test webhook
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

**Expected response:**
```json
{
  "success": true,
  "flow_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted",
  "message": "Flow run created with priority 70"
}
```

---

## Step 6: Configure Supabase Webhook (3 minutes)

1. **Go to Supabase Dashboard:**
   - URL: https://supabase.com/dashboard/project/stbnsczvywpwjzbpfehp

2. **Navigate to Database → Webhooks**

3. **Click "Enable Webhooks"** (if not already enabled)

4. **Create New Webhook:**
   - Name: `prefect-video-processing`
   - URL: `http://localhost:8000/webhooks/supabase/videos` (for local testing)
   - Method: `POST`
   - Headers: `Authorization: Bearer {your-webhook-secret}`
   - Events: `INSERT`
   - Table: `videos`
   - Schema: `captionacc_production`

5. **Click "Create"**

---

## Step 7: Test Complete Flow (2 minutes)

### Option A: Via Supabase (recommended)

Insert a test video record in Supabase:

```sql
-- In Supabase SQL Editor
INSERT INTO captionacc_production.videos (
  id,
  tenant_id,
  storage_key,
  status,
  uploaded_at
) VALUES (
  'test-video-' || gen_random_uuid()::text,
  'test-tenant-456',
  'test-tenant-456/client/videos/test/video.mp4',
  'uploading',
  NOW()
);
```

### Option B: Via API

```bash
curl -X POST http://localhost:8000/webhooks/supabase/videos \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"INSERT\",
    \"table\": \"videos\",
    \"record\": {
      \"id\": \"test-video-$(uuidgen)\",
      \"tenant_id\": \"test-tenant-456\",
      \"storage_key\": \"test-tenant-456/client/videos/test/video.mp4\",
      \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }
  }"
```

### Monitor Flow Execution

1. **Check API logs:**
   ```
   INFO - [Worker] Polling for flow runs from work pool 'captionacc-workers'...
   INFO - [Worker] Submitting flow run '...' for execution
   ```

2. **Check Prefect UI:**
   - Visit: https://prefect-service.fly.dev
   - Navigate to Flow Runs
   - Click on latest run
   - View logs and status

3. **Check video status in Supabase:**
   ```sql
   SELECT id, status, created_at, updated_at
   FROM captionacc_production.videos
   WHERE id = 'test-video-...';
   ```

---

## Verification Checklist

After completing all steps, verify:

- [ ] **API service running** - http://localhost:8000/health returns 200
- [ ] **Prefect worker connected** - Logs show "Prefect worker started successfully"
- [ ] **Modal functions deployed** - `modal app list` shows functions
- [ ] **Flows registered** - Prefect UI shows 3 deployments
- [ ] **Webhook endpoint working** - Test curl returns 202
- [ ] **Supabase webhook configured** - Dashboard shows active webhook
- [ ] **Flow execution working** - Prefect UI shows flow runs

---

## Troubleshooting

### "PREFECT_API_URL not configured"

**Problem:** Environment variable not set.

**Solution:**
```bash
echo "PREFECT_API_URL=https://prefect-service.fly.dev/api" >> services/api/.env
# Restart API service
```

### "Unauthorized" from webhook

**Problem:** Webhook secret mismatch.

**Solution:**
```bash
# Check what's in .env
grep WEBHOOK_SECRET services/api/.env

# Make sure curl uses same secret
export WEBHOOK_SECRET="same-value-as-in-env"
```

### "Modal function not found"

**Problem:** Functions not deployed.

**Solution:**
```bash
# Redeploy all functions
cd data-pipelines/captionacc-modal
modal deploy src/captionacc_modal/extract.py
modal deploy src/captionacc_modal/inference.py
modal deploy src/captionacc_modal/ocr.py
```

### Worker not starting

**Problem:** Prefect server unreachable.

**Solution:**
```bash
# Test Prefect server
curl https://prefect-service.fly.dev/api/health

# If fails, check network/VPN
# If succeeds, check PREFECT_API_URL in .env
```

### Flow stuck in "Scheduled"

**Problem:** Worker not polling or crashed.

**Solution:**
```bash
# Check if worker process is running
ps aux | grep "prefect worker"

# Check API logs for worker output
# Look for: [Worker] log lines

# If missing, restart API service
```

---

## Quick Commands Reference

```bash
# Start API service
cd services/api && uvicorn app.main:app --reload --port 8000

# Test webhook
curl -X POST http://localhost:8000/webhooks/supabase/videos \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"type":"INSERT","table":"videos","record":{"id":"test","tenant_id":"test","storage_key":"test.mp4","created_at":"2024-01-12T00:00:00Z"}}'

# Check Prefect deployments
export PREFECT_API_URL=https://prefect-service.fly.dev/api
prefect deployment ls

# View flow runs
prefect flow-run ls --limit 10

# Check Modal apps
modal app list

# Redeploy Modal function
modal deploy data-pipelines/captionacc-modal/src/captionacc_modal/extract.py

# Re-register flows
cd services/api && ./scripts/register_flows.sh
```

---

## Next Steps

Once the system is running:

1. **Test with real video:**
   - Upload actual video file to Wasabi
   - Insert video record in Supabase
   - Monitor complete processing flow

2. **Test layout approval:**
   - Use web app to draw crop region
   - Click "Approve Layout"
   - Verify crop_and_infer flow executes

3. **Test caption OCR:**
   - Select caption in web app
   - Request OCR
   - Verify caption_ocr flow executes

4. **Review logs and metrics:**
   - Check Prefect UI for flow run history
   - Review API logs for errors
   - Monitor performance metrics

5. **Read full documentation:**
   - Architecture: `/docs/prefect-orchestration/IMPLEMENTATION_COMPLETE.md`
   - Testing: `/docs/prefect-orchestration/TEST_PLAN.md`
   - Design decisions: `/docs/prefect-orchestration/INTERFACE_DECISIONS.md`

---

## Production Deployment

For production deployment:

1. **Update webhook URL:**
   - Change from `http://localhost:8000` to production domain
   - Update in Supabase webhook configuration

2. **Set production secrets:**
   - Generate strong webhook secret
   - Use production Prefect API key if required
   - Verify all credentials are production values

3. **Deploy API service:**
   - Deploy to production environment (Fly.io/Railway/etc.)
   - Ensure environment variables are set
   - Verify worker starts successfully

4. **Monitor first production runs:**
   - Watch Prefect UI closely
   - Monitor API logs
   - Check video processing completes successfully

5. **Setup alerts:**
   - Configure Prefect notifications for flow failures
   - Setup API monitoring (uptime, errors)
   - Create dashboards for key metrics

---

## Support

If you encounter issues:

1. **Check logs:** API service logs show detailed error messages
2. **Check Prefect UI:** https://prefect-service.fly.dev for flow status
3. **Check documentation:** `/docs/prefect-orchestration/`
4. **Review test plan:** Includes troubleshooting for common issues

**System Status:** ✅ Implementation Complete - Ready for Testing

