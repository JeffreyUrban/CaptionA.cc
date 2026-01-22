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

### Deploy to Supabase Projects

Functions are unified - deploy the same code to each Supabase project (prod/dev).
Each project has its own secrets configured.

**Important:** Deploy with `--no-verify-jwt` flag. This disables Supabase's gateway-level
JWT verification and lets the functions handle authentication themselves (via `getUser(token)`).
This is required because the gateway verification can fail even with valid JWTs in certain scenarios.

**Project References:**
- Production: `<SUPABASE_PROD_PROJECT_REF>` (e.g., `cuvzwbtarrkngqeqmdaz`)
- Development: `<SUPABASE_DEV_PROJECT_REF>` (e.g., `okxgkojcukqjzlrqrmox`)

```bash
cd supabase

# ============================================================================
# PRODUCTION DEPLOYMENT
# ============================================================================

# Set secrets for prod (first time or when updating)
supabase secrets set DB_SCHEMA=captionacc --project-ref <SUPABASE_PROD_PROJECT_REF>
supabase secrets set WASABI_BUCKET=captionacc-prod --project-ref <SUPABASE_PROD_PROJECT_REF>
supabase secrets set WASABI_REGION=us-east-1 --project-ref <SUPABASE_PROD_PROJECT_REF>
supabase secrets set WASABI_ACCESS_KEY_READWRITE=<WASABI_PROD_READWRITE_KEY> --project-ref <SUPABASE_PROD_PROJECT_REF>
supabase secrets set WASABI_SECRET_KEY_READWRITE=<WASABI_PROD_READWRITE_SECRET> --project-ref <SUPABASE_PROD_PROJECT_REF>

# STS secrets for s3-credentials (requires Wasabi IAM setup - see below)
supabase secrets set WASABI_STS_ACCESS_KEY=<WASABI_STS_ASSUMER_KEY> --project-ref <SUPABASE_PROD_PROJECT_REF>
supabase secrets set WASABI_STS_SECRET_KEY=<WASABI_STS_ASSUMER_SECRET> --project-ref <SUPABASE_PROD_PROJECT_REF>
supabase secrets set WASABI_STS_ROLE_ARN=arn:aws:iam::<WASABI_ACCOUNT>:role/captionacc-client-read --project-ref <SUPABASE_PROD_PROJECT_REF>

# Deploy functions to prod (--no-verify-jwt lets functions handle their own auth)
supabase functions deploy captionacc-presigned-upload --project-ref <SUPABASE_PROD_PROJECT_REF> --no-verify-jwt
supabase functions deploy captionacc-s3-credentials --project-ref <SUPABASE_PROD_PROJECT_REF> --no-verify-jwt

# ============================================================================
# DEVELOPMENT DEPLOYMENT
# ============================================================================

# Set secrets for dev (first time or when updating)
supabase secrets set DB_SCHEMA=captionacc --project-ref <SUPABASE_DEV_PROJECT_REF>
supabase secrets set WASABI_BUCKET=captionacc-dev --project-ref <SUPABASE_DEV_PROJECT_REF>
supabase secrets set WASABI_REGION=us-east-1 --project-ref <SUPABASE_DEV_PROJECT_REF>
supabase secrets set WASABI_ACCESS_KEY_READWRITE=<WASABI_DEV_READWRITE_KEY> --project-ref <SUPABASE_DEV_PROJECT_REF>
supabase secrets set WASABI_SECRET_KEY_READWRITE=<WASABI_DEV_READWRITE_SECRET> --project-ref <SUPABASE_DEV_PROJECT_REF>

# STS secrets for s3-credentials (requires Wasabi IAM setup - see below)
supabase secrets set WASABI_STS_ACCESS_KEY=<WASABI_STS_ASSUMER_KEY> --project-ref <SUPABASE_DEV_PROJECT_REF>
supabase secrets set WASABI_STS_SECRET_KEY=<WASABI_STS_ASSUMER_SECRET> --project-ref <SUPABASE_DEV_PROJECT_REF>
supabase secrets set WASABI_STS_ROLE_ARN=arn:aws:iam::<WASABI_ACCOUNT>:role/captionacc-client-read --project-ref <SUPABASE_DEV_PROJECT_REF>

# Deploy functions to dev (--no-verify-jwt lets functions handle their own auth)
supabase functions deploy captionacc-presigned-upload --project-ref <SUPABASE_DEV_PROJECT_REF> --no-verify-jwt
supabase functions deploy captionacc-s3-credentials --project-ref <SUPABASE_DEV_PROJECT_REF> --no-verify-jwt
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
| `DB_SCHEMA` | both | Database schema (default: captionacc) |

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available in edge functions.

## Shared Code

The `_shared/` directory contains common utilities:

- `cors.ts` - CORS headers and preflight handling
- `wasabi.ts` - Wasabi S3 presigned URL generation (AWS Sig V4)
- `sts.ts` - Wasabi STS AssumeRole (AWS Sig V4)
