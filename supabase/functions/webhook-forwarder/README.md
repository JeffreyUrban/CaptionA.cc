# Webhook Forwarder Edge Function

Supabase Edge Function that forwards database webhooks to captionacc-api with automatic retry logic to handle Fly.io machine wake-up delays.

## Why This Exists

captionacc-api uses Fly.io's `auto_stop_machines` to save costs. When stopped, machines take up to 60 seconds to wake up (grace period). Supabase webhooks have a fixed 5-second timeout, which is too short for machine wake-up.

This edge function:
- Receives webhook immediately (no timeout from Supabase)
- **Filters UPDATE events** to only forward soft-deletes (prevents unnecessary API wake-ups)
- Forwards to captionacc-api with retry logic (exponential backoff)
- Waits up to 65 seconds total (enough for machine wake-up + processing)
- Retries on timeout/5xx errors with intelligent backoff

## Deployment

Deploy the edge function to Supabase:

```bash
# From repository root
supabase functions deploy webhook-forwarder
```

## Webhook Configuration

### Step 1: Get the Edge Function URL

After deployment, your edge function URL will be:
```
https://[your-project-ref].supabase.co/functions/v1/webhook-forwarder
```

### Step 2: Configure Database Webhook

In Supabase Dashboard → Database → Webhooks:

#### Basic Settings
- **Name**: `videos-webhook-forwarder` (or any descriptive name)
- **Table**: `videos`
- **Events**: Check `INSERT` and `DELETE`
- **Type**: `HTTP Request`
- **Method**: `POST`
- **URL**: `https://[your-project-ref].supabase.co/functions/v1/webhook-forwarder`

#### HTTP Headers

Add these headers:

1. **Content-Type**
   - Name: `Content-type`
   - Value: `application/json`

2. **Edge Function Authorization** (Supabase anon key)
   - Name: `Authorization`
   - Value: `Bearer [your-supabase-anon-key]`

3. **API Webhook Secret** (captionacc-api webhook secret)
   - Name: `x-webhook-secret`
   - Value: `Bearer [your-webhook-secret]`
   - ⚠️  Use the same secret as `WEBHOOK_SECRET` in captionacc-api

#### HTTP Parameters

Add these parameters to configure the forwarder:

1. **Target Path** (required)
   - Name: `target_path`
   - Value: `/webhooks/supabase/videos`

2. **Max Retries** (optional, default: 5)
   - Name: `max_retries`
   - Value: `5`

3. **Initial Delay** (optional, default: 2000ms)
   - Name: `initial_delay_ms`
   - Value: `2000`

4. **Max Delay** (optional, default: 15000ms)
   - Name: `max_delay_ms`
   - Value: `15000`

5. **Total Timeout** (optional, default: 65000ms)
   - Name: `total_timeout_ms`
   - Value: `65000`

#### Webhook Timeout

Set the Supabase webhook timeout:
- **Timeout**: `10000` ms (10 seconds)
- Note: This is the timeout for calling the edge function, not the total forwarding time

### Step 3: Test the Webhook

Upload a video to test:

```bash
# Upload will trigger INSERT webhook
# Edge function logs visible in Supabase Dashboard → Edge Functions → webhook-forwarder → Logs
```

## Event Filtering

The edge function intelligently filters events to minimize unnecessary API wake-ups:

**INSERT Events**: Always forwarded to trigger video processing

**UPDATE Events**: Only forwarded if the update is a **soft-delete**
- Soft-delete detection: `deleted_at` changed from `NULL` to a timestamp
- Other updates (status changes, metadata updates, etc.) are ignored
- This prevents waking up the API for every video status change

**Example**:
```
Video status: uploading → processing  ❌ Not forwarded (not a soft-delete)
Video metadata updated                ❌ Not forwarded (not a soft-delete)
Video soft-deleted (deleted_at set)   ✅ Forwarded (triggers flow cancellation)
```

This filtering happens **before** the API is contacted, so machines stay asleep for irrelevant updates.

## Retry Behavior

The edge function uses exponential backoff with jitter:

**Default Configuration:**
- Attempt 1: Immediate (0ms delay)
- Attempt 2: ~2s delay
- Attempt 3: ~4s delay
- Attempt 4: ~8s delay
- Attempt 5: ~15s delay (capped at max_delay_ms)
- **Total timeout: 65 seconds** (enough for 60s Fly.io grace period + processing)

**Example Timeline:**
```
0s:  Attempt 1 (fails - machine sleeping)
2s:  Attempt 2 (fails - machine waking up)
6s:  Attempt 3 (fails - machine still starting)
14s: Attempt 4 (fails - machine almost ready)
29s: Attempt 5 (succeeds - machine awake, processes request)
```

## Error Handling

**No Retry (Immediate Failure):**
- 4xx client errors (bad request, auth failure, etc.)
- Missing x-webhook-secret header
- Invalid JSON payload

**Retry with Backoff:**
- Timeouts (machine not responding)
- 5xx server errors (machine error during startup)
- Network errors (connection refused, etc.)

**Final Failure After All Retries:**
- Returns 502 Bad Gateway with error details
- Logs full retry history for debugging

## Monitoring

View logs in Supabase Dashboard:
1. Go to **Edge Functions** → **webhook-forwarder** → **Logs**
2. Filter by time range to see recent webhook forwards
3. Look for:
   - `[Forwarder] ✅ Success after N attempts` - successful forward
   - `[Forwarder] ❌ Client error` - auth or payload issue (check captionacc-api config)
   - `[Forwarder] ⏱️  Attempt N timed out` - machine still waking up (normal for early attempts)
   - `[Forwarder] ❌ All N attempts failed` - machine not starting (check Fly.io status)

## Troubleshooting

### Webhook Not Firing

**Symptom**: Video uploaded but no edge function logs

**Check**:
1. Webhook is configured in Supabase Dashboard → Database → Webhooks
2. Events are checked (INSERT, DELETE)
3. Table filter matches (`videos` table)

### Edge Function Auth Failure

**Symptom**: Edge function logs show "Missing x-webhook-secret header"

**Fix**:
1. Add `x-webhook-secret` header in webhook configuration
2. Value should be `Bearer [webhook-secret]`
3. Must match `WEBHOOK_SECRET` in captionacc-api

### All Retries Failing

**Symptom**: Edge function logs show "All 5 attempts failed"

**Check**:
1. captionacc-api is running: `flyctl status -a captionacc-api`
2. Machine health checks passing: `flyctl checks list -a captionacc-api`
3. Webhook secret is correct (test manually with curl)

**Test API directly**:
```bash
curl -X POST https://captionacc-api.fly.dev/webhooks/supabase/videos \
  -H "Authorization: Bearer [webhook-secret]" \
  -H "Content-Type: application/json" \
  -d '{"type":"INSERT","table":"videos","record":{"id":"test","tenant_id":"test"}}'
```

### Machine Taking Too Long to Wake

**Symptom**: First 3-4 attempts timeout, but eventually succeeds

**This is normal!** Fly.io machines have a 60s grace period. The edge function is designed to handle this.

**If consistently taking >60s**:
1. Check machine size (1GB memory should be sufficient)
2. Check startup logs: `flyctl logs -a captionacc-api`
3. Consider increasing `total_timeout_ms` to 90000 (90s)

## Cost Impact

**Supabase Edge Functions:**
- First 500K requests/month: Free
- After that: $2 per million requests
- This webhook forwarder: ~5-10 requests per video (with retries)
- Cost: Effectively free for most usage

**Fly.io Machines:**
- With `auto_stop_machines`: Pay only when running
- Typical cost: ~$0.01-0.02 per video processed (1-2 minutes runtime)
- vs. always-on: ~$2-3/month for 1GB shared CPU
- **Savings: ~90-95% reduction in compute costs**

## Alternative: Always-On Machine

If you prefer simpler configuration without retries, you can keep the machine always running:

```toml
# fly.toml
[http_service]
  auto_stop_machines = false
  min_machines_running = 1
```

Then configure webhook to call API directly:
- URL: `https://captionacc-api.fly.dev/webhooks/supabase/videos`
- No edge function needed

**Trade-off**: ~$2-3/month cost vs. free edge function with retries
