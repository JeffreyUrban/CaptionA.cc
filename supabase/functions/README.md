# Supabase Edge Functions

Edge Functions for CaptionA.cc server-side operations.

## Functions

### captionacc-presigned-upload

Generates presigned PUT URLs for direct video upload to Wasabi S3.

**Endpoint:** `POST /functions/v1/captionacc-presigned-upload`

**Request:**
```json
{
  "filename": "video.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 104857600
}
```

**Response:**
```json
{
  "uploadUrl": "https://caption-acc-prod.s3.us-east-1.wasabisys.com/...",
  "videoId": "uuid",
  "storageKey": "tenant_id/videos/video_id/video.mp4",
  "expiresAt": "2026-01-11T11:00:00Z"
}
```

## Development

### Local Testing

```bash
# Start Supabase local
cd supabase
supabase start

# Serve functions locally
supabase functions serve --env-file ../.env
```

Test with curl:
```bash
curl -X POST http://localhost:54321/functions/v1/captionacc-presigned-upload \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.mp4", "contentType": "video/mp4", "sizeBytes": 1000000}'
```

### Deploy to Production

```bash
cd supabase

# Set secrets (first time only)
supabase secrets set WASABI_ACCESS_KEY_READWRITE=your_key
supabase secrets set WASABI_SECRET_KEY_READWRITE=your_secret
supabase secrets set WASABI_BUCKET=caption-acc-prod
supabase secrets set WASABI_REGION=us-east-1
supabase secrets set DB_SCHEMA=captionacc_production

# Deploy function
supabase functions deploy captionacc-presigned-upload
```

### Required Secrets

| Secret | Description |
|--------|-------------|
| `WASABI_ACCESS_KEY_READWRITE` | Wasabi access key with write permission |
| `WASABI_SECRET_KEY_READWRITE` | Wasabi secret key |
| `WASABI_BUCKET` | Wasabi bucket name |
| `WASABI_REGION` | Wasabi region (default: us-east-1) |
| `DB_SCHEMA` | Database schema (default: captionacc_production) |

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available in edge functions.

## Shared Code

The `_shared/` directory contains common utilities:

- `cors.ts` - CORS headers and preflight handling
- `wasabi.ts` - Wasabi S3 presigned URL generation (AWS Sig V4)
