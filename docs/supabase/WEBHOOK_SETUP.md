# Database Webhook Setup Guide

This guide shows how to configure the Supabase Database Webhook that triggers video processing when videos are uploaded.

## What This Webhook Does

When a user uploads a video, the Edge Function creates a record in the `videos` table. This webhook:
1. Detects the INSERT event on `captionacc_prod.videos`
2. Sends a POST request to `captionacc-api.fly.dev`
3. Triggers the `captionacc-video-initial-processing` Prefect flow
4. The flow extracts frames, runs OCR, and creates the initial layout database

**Architecture:**
```
Video Upload → INSERT videos → Webhook → API Service → Prefect Flow → Modal GPU Processing
```

See [/docs/prefect-orchestration/ARCHITECTURE.md](../../docs/prefect-orchestration/ARCHITECTURE.md) for the full system design.

---

## Prerequisites

1. **Webhook Secret**: A secure token for authenticating webhook requests

   Generate a new secret:
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. **Set the secret in Fly.io** (captionacc-api service):
   ```bash
   fly secrets set WEBHOOK_SECRET="<generated-secret>" --app captionacc-api
   ```

   This deploys the API service with the new secret.

---

## Configuration Steps

### 1. Enable Webhooks in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → Select your project
2. Navigate to **Database** → **Webhooks**
3. Click **"Enable webhooks"** button

### 2. Create the Webhook

Click **"Create a new hook"** and configure:

| Field | Value |
|-------|-------|
| **Name** | `captionacc-video-insert` |
| **Schema** | `captionacc_prod` |
| **Table** | `videos` |
| **Events** | `INSERT` (check only this box) |
| **Type** | `HTTP Request` |
| **Method** | `POST` |
| **URL** | `https://captionacc-api.fly.dev/webhooks/supabase/videos` |

### 3. Add HTTP Headers

In the "HTTP Headers" section, add:

```
Authorization: Bearer <your-webhook-secret>
Content-Type: application/json
```

Replace `<your-webhook-secret>` with the value you set in Fly.io secrets.

### 4. Save and Enable

1. Click **"Create webhook"**
2. Ensure the webhook is **enabled** (toggle should be green)

---

## Verification

### Test the Webhook

1. Upload a test video through the web UI
2. Check that the video status changes from `processing` to `active`
3. Verify frames were extracted (check Wasabi storage)

### Check Logs

**API Service logs:**
```bash
fly logs --app captionacc-api
```

Look for:
```
Triggering video initial processing for video <uuid>
```

**Prefect flow logs:**
```bash
fly logs --app banchelabs-gateway
```

Look for flow run creation in work pool `captionacc-workers`.

### Troubleshooting

**Webhook returns 401 Unauthorized:**
- Verify `WEBHOOK_SECRET` matches in both Supabase webhook headers and Fly.io secrets

**Webhook returns 404:**
- Check `captionacc-api` Fly.io app is running: `fly status --app captionacc-api`
- The machine should auto-start when webhook fires (if stopped)

**No processing happens:**
- Check webhook is enabled in Supabase
- Verify webhook URL is correct (should be `https://captionacc-api.fly.dev/webhooks/supabase/videos`)
- Check Prefect server is running: `fly status --app banchelabs-gateway`

---

## Security Notes

- **Never commit the webhook secret to git**
- Store only in Fly.io secrets and Supabase webhook config
- Rotate periodically by generating a new secret and updating both services
- The webhook authenticates with Bearer token (server-to-server, no user context)

---

## Related Documentation

- [/docs/prefect-orchestration/ARCHITECTURE.md](../../docs/prefect-orchestration/ARCHITECTURE.md) - System architecture
- [/docs/prefect-orchestration/flows.md](../../docs/prefect-orchestration/flows.md) - Flow specifications
- [/docs/prefect-orchestration/operations.md](../../docs/prefect-orchestration/operations.md) - Troubleshooting guide
