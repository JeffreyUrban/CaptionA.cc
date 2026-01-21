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
  "uploadUrl": "https://captionacc-prod.s3.us-east-1.wasabisys.com/...",
  "videoId": "uuid",
  "storageKey": "tenant_id/client/videos/video_id/video.mp4",
  "expiresAt": "2026-01-11T11:00:00Z"
}
```

### captionacc-s3-credentials

Returns temporary STS credentials for direct Wasabi S3 read access, scoped to the tenant's `client/` paths.

**Endpoint:** `GET /functions/v1/captionacc-s3-credentials`

**Response:**
```json
{
  "credentials": {
    "accessKeyId": "ASIA...",
    "secretAccessKey": "...",
    "sessionToken": "..."
  },
  "expiration": "2026-01-11T23:00:00Z",
  "bucket": "captionacc-prod",
  "region": "us-east-1",
  "endpoint": "https://s3.us-east-1.wasabisys.com",
  "prefix": "{tenant_id}/client/*"
}
```

**Access scope:** (`{tenant_id}/client/*`)
- ✅ `client/videos/{id}/video.mp4` - Original video
- ✅ `client/videos/{id}/full_frames/*.jpg` - Frame images
- ✅ `client/videos/{id}/cropped_frames_v*/*.webm` - Video chunks
- ✅ `client/videos/{id}/layout.db.gz` - Layout database (use presigned URLs for versioning)
- ✅ `client/videos/{id}/captions.db.gz` - Captions database (use presigned URLs for versioning)
- ❌ `server/*` - Server-only, never accessible

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

# Set shared secrets (first time only)
supabase secrets set WASABI_BUCKET=captionacc-prod
supabase secrets set WASABI_REGION=us-east-1
supabase secrets set DB_SCHEMA=captionacc_prod

# Set presigned-upload secrets
supabase secrets set WASABI_ACCESS_KEY_READWRITE=your_key
supabase secrets set WASABI_SECRET_KEY_READWRITE=your_secret

# Set s3-credentials secrets (requires Wasabi IAM setup first - see below)
supabase secrets set WASABI_STS_ACCESS_KEY=your_sts_assumer_key
supabase secrets set WASABI_STS_SECRET_KEY=your_sts_assumer_secret
supabase secrets set WASABI_STS_ROLE_ARN=arn:aws:iam::ACCOUNT:role/captionacc-client-read
supabase secrets set WASABI_STS_DURATION_SECONDS=3600

# Deploy functions
supabase functions deploy captionacc-presigned-upload
supabase functions deploy captionacc-s3-credentials
```

### Wasabi IAM Setup (for s3-credentials)

Before deploying `captionacc-s3-credentials`, set up Wasabi IAM:

1. **Create IAM role** `captionacc-client-read`:
   - Trust policy: Allow `captionacc-sts-assumer` user to assume it
   - Permissions: `s3:GetObject` on `arn:aws:s3:::captionacc-prod/*/client/*`

2. **Create IAM user** `captionacc-sts-assumer`:
   - Permissions: `sts:AssumeRole` on the role above
   - Generate access keys for `WASABI_STS_ACCESS_KEY` / `WASABI_STS_SECRET_KEY`

See [wasabi-storage.md](../../docs/data-architecture/wasabi-storage.md) for full IAM policy examples.

### Required Secrets

| Secret | Used By | Description |
|--------|---------|-------------|
| `WASABI_ACCESS_KEY_READWRITE` | presigned-upload | Wasabi access key with write permission |
| `WASABI_SECRET_KEY_READWRITE` | presigned-upload | Wasabi secret key for writes |
| `WASABI_STS_ACCESS_KEY` | s3-credentials | Wasabi STS assumer access key |
| `WASABI_STS_SECRET_KEY` | s3-credentials | Wasabi STS assumer secret key |
| `WASABI_STS_ROLE_ARN` | s3-credentials | IAM role ARN for AssumeRole |
| `WASABI_BUCKET` | both | Wasabi bucket name |
| `WASABI_REGION` | both | Wasabi region (default: us-east-1) |
| `WASABI_STS_DURATION_SECONDS` | s3-credentials | Credential duration (default: 3600) |
| `DB_SCHEMA` | both | Database schema (default: captionacc_prod) |

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available in edge functions.

## Shared Code

The `_shared/` directory contains common utilities:

- `cors.ts` - CORS headers and preflight handling
- `wasabi.ts` - Wasabi S3 presigned URL generation (AWS Sig V4)
- `sts.ts` - Wasabi STS AssumeRole (AWS Sig V4)
