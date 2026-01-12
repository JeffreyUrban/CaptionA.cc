# Wasabi S3 Storage

This directory contains Wasabi storage documentation for CaptionA.cc.

## Quick Reference

| Property | Value |
|----------|-------|
| Bucket | `caption-acc-prod` |
| Region | `us-east-1` |
| Endpoint | `https://s3.us-east-1.wasabisys.com` |

## Storage Path Structure

Paths are organized by **access level** at the top for simple IAM policies:

```
caption-acc-prod/
└── {tenant_id}/
    ├── client/                          # Tenant-accessible via STS credentials
    │   └── videos/{video_id}/
    │       ├── video.mp4                # Original video
    │       ├── layout.db.gz             # CR-SQLite synced
    │       ├── captions.db.gz           # CR-SQLite synced
    │       ├── full_frames/             # Frame images (0.1Hz)
    │       │   ├── frame_000000.jpg
    │       │   └── ...
    │       └── cropped_frames_v{N}/     # VP9 WebM chunks
    │           ├── modulo_16/
    │           ├── modulo_4/
    │           └── modulo_1/
    │
    └── server/                          # Server-only (never client-accessible)
        └── videos/{video_id}/
            ├── ocr-server.db.gz         # Full OCR results (gzip)
            └── layout-server.db.gz      # ML model, analysis params (gzip)
```

**Security principle:** Access level (`client/` vs `server/`) at the top enables simple IAM policies without wildcards in the middle of paths.

## Client Access Methods

| Content | Access Method | Notes |
|---------|---------------|-------|
| Media (chunks, frames, video) | STS credentials | High volume, direct S3 access |
| Databases (layout.db.gz, captions.db.gz) | STS credentials | Lock API provides version info |
| Server files | None | Never client-accessible |

### STS Credentials (for downloads)

Browser gets temporary credentials scoped to `{tenant_id}/client/*`:

```
GET /functions/v1/captionacc-s3-credentials
Authorization: Bearer <jwt>

Response:
{
  "credentials": { "accessKeyId": "...", "secretAccessKey": "...", "sessionToken": "..." },
  "expiration": "2026-01-11T23:00:00Z",
  "bucket": "caption-acc-prod",
  "region": "us-east-1",
  "endpoint": "https://s3.us-east-1.wasabisys.com",
  "prefix": "{tenant_id}/client/*"
}
```

See: [IAM Policies](./wasabi-iam-policies/) for STS setup

## IAM Users

| User | Purpose | Permissions |
|------|---------|-------------|
| `captionacc-app-readonly` | API server-side reads | GetObject on `*/client/*` |
| `captionacc-orchestrator` | Processing pipelines | Full access |
| `captionacc-sts-assumer` | STS AssumeRole | sts:AssumeRole only |

See: [IAM Policies](./wasabi-iam-policies/) for policy templates

## Security Features

**Bucket-level:**
- ✅ Versioning (corruption recovery)
- ✅ Access logging → `audit-logs-caption-acc` (90-day retention)
- ✅ Public access blocked
- ✅ Server-side encryption (Wasabi default)

**Application-level:**
- ✅ STS credentials with session policies (tenant-scoped)
- ✅ Tenant validation before all S3 ops
- ✅ RLS policies on Supabase

## Key Design Decisions

### 1. Split Credentials (Readonly vs Readwrite)

Web app uses read-only credentials, orchestrator uses read-write credentials. Credential leak limits blast radius.

### 2. STS for Browser Access

Browsers get temporary, tenant-scoped credentials instead of presigned URLs for each file. Reduces API load for high-volume media access.

### 3. Path-Based Tenant Isolation

Access level (`client/` vs `server/`) at path top enables simple IAM policies. Tenant isolation enforced by session policy at STS assume-role time.

### 4. Gzip Compression for Databases

Client-facing databases are gzip compressed (~60-70% reduction). Browser decompresses using native `DecompressionStream`.

## Documentation

| File | Purpose |
|------|---------|
| [wasabi-iam-policies/](./wasabi-iam-policies/) | IAM policy templates and STS setup |
| [BUCKET_CONFIGURATION.md](./BUCKET_CONFIGURATION.md) | Logging, lifecycle, bucket setup |
| [CREDENTIAL_ROTATION.md](./CREDENTIAL_ROTATION.md) | Rotation process and schedule |

## Environment Variables

```bash
# Read-only credentials (API server)
WASABI_ACCESS_KEY_READONLY=<key>
WASABI_SECRET_KEY_READONLY=<secret>

# Read-write credentials (orchestrator)
WASABI_ACCESS_KEY_READWRITE=<key>
WASABI_SECRET_KEY_READWRITE=<secret>

# STS assumer credentials (Edge Function)
WASABI_STS_ACCESS_KEY=<key>
WASABI_STS_SECRET_KEY=<secret>
WASABI_STS_ROLE_ARN=arn:aws:iam::WASABI_ACCOUNT_ID:role/captionacc-client-read

# Bucket configuration
WASABI_BUCKET=caption-acc-prod
WASABI_REGION=us-east-1
```

## Common Operations

**Get STS credentials for browser:**
```bash
curl -H "Authorization: Bearer <jwt>" \
  https://<project>.supabase.co/functions/v1/captionacc-s3-credentials
```

**Test credential restrictions:**
```bash
# Should fail (good!)
aws s3 ls --endpoint-url https://s3.us-east-1.wasabisys.com

# Should succeed
aws s3 ls s3://caption-acc-prod/ --endpoint-url https://s3.us-east-1.wasabisys.com
```

**Review access logs:**
```bash
aws s3 ls s3://audit-logs-caption-acc/caption-acc-prod/ \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```
