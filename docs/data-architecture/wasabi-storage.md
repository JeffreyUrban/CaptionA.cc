# Wasabi Storage Configuration

Operational configuration for Wasabi S3. For storage structure and data flow, see [README.md](./README.md). For database schemas, see [sqlite-databases.md](./sqlite-databases.md).

## Bucket Configuration

| Property | Value |
|----------|-------|
| Bucket Name | `caption-acc-prod` |
| Region | `us-east-1` |
| Endpoint | `https://s3.us-east-1.wasabisys.com` |
| Versioning | Enabled (corruption recovery) |
| Public Access | Blocked |
| Access Logging | Enabled |

### Audit Logs Bucket

| Property | Value |
|----------|-------|
| Bucket Name | `audit-logs-caption-acc` |
| Log Prefix | `caption-acc-prod/` |
| Retention | 90 days (lifecycle policy) |

## Storage Path Structure

Paths are organized by **access level** for security:

```
caption-acc-prod/
└── {tenant_id}/videos/{video_id}/
    ├── client/                      # Tenant-accessible via STS credentials
    │   ├── video.mp4                # Original video
    │   ├── full_frames/             # Frame images (0.1Hz)
    │   │   ├── frame_000000.jpg
    │   │   └── ...
    │   └── cropped_frames_v{N}/     # VP9 WebM chunks
    │       ├── modulo_16/
    │       ├── modulo_4/
    │       └── modulo_1/
    │
    ├── sync/                        # Accessed via presigned URLs (sync API)
    │   ├── layout.db.gz             # CR-SQLite synced
    │   └── captions.db.gz           # CR-SQLite synced
    │
    └── server/                      # Server-only (never client-accessible)
        ├── ocr-server.db            # Full OCR results
        └── layout-server.db         # ML model, analysis params
```

**Security principle:** Path structure enforces access boundaries. STS credentials grant access to `client/*` only. Server-only files are in a separate path that's never included in client credentials.

## IAM Configuration

### IAM Users

| User | Purpose | Permissions |
|------|---------|-------------|
| `captionacc-app-readonly` | API presigned URLs (sync/) | GetObject on `*/sync/*` |
| `captionacc-orchestrator` | Processing pipelines | Full access (GetObject, PutObject, DeleteObject) |
| `captionacc-sts-assumer` | STS AssumeRole for client credentials | sts:AssumeRole |

### IAM Role for Client Access

**Role:** `captionacc-client-read`

**Trust Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::{account}:user/captionacc-sts-assumer"
    },
    "Action": "sts:AssumeRole"
  }]
}
```

**Permissions Policy (base - scoped down by session policy):**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::caption-acc-prod/*/videos/*/client/*"
  }]
}
```

### Session Policy (passed at AssumeRole time)

Scopes credentials to a specific tenant:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::caption-acc-prod/{tenant_id}/videos/*/client/*"
  }]
}
```

**Result:** Tenant can read all their videos' `client/` assets, but cannot:
- Write/upload anything
- Access other tenants' files
- Access `sync/` databases (use presigned URLs)
- Access `server/` proprietary files

## Client Access Methods

| Path | Access Method | Duration | Use Case |
|------|--------------|----------|----------|
| `client/*` | STS credentials | 1-12 hours | High-volume media (chunks, frames) |
| `sync/*.db.gz` | Presigned URL | 15 min | Database download (versioned) |
| `server/*` | None (server only) | — | Proprietary ML data |

### STS Credentials Flow

```
1. Client authenticates with API
2. API calls Wasabi STS AssumeRole with session policy
3. API returns temporary credentials scoped to tenant's client/ path
4. Client uses credentials directly with S3 SDK
5. All media requests go straight to Wasabi (no API)
```

### Presigned URL Flow (sync databases)

```
1. Client requests download URL via sync API
2. API generates presigned URL (readonly key)
3. Client downloads directly from Wasabi
4. Presigned URL expires after 15 minutes
```

## Environment Variables

```bash
# Read-only credentials (API server - presigned URLs for sync/)
WASABI_ACCESS_KEY_READONLY=<key>
WASABI_SECRET_KEY_READONLY=<secret>

# Read-write credentials (orchestrator)
WASABI_ACCESS_KEY_READWRITE=<key>
WASABI_SECRET_KEY_READWRITE=<secret>

# STS assumer credentials (for client STS)
WASABI_STS_ACCESS_KEY=<key>
WASABI_STS_SECRET_KEY=<secret>
WASABI_STS_ROLE_ARN=arn:aws:iam::{account}:role/captionacc-client-read

# Bucket configuration
WASABI_BUCKET=caption-acc-prod
WASABI_REGION=us-east-1
```

## Security

- **Versioning**: Enabled for corruption recovery
- **Encryption**: Server-side (Wasabi default)
- **Public Access**: Blocked at bucket level
- **Access Logging**: 90-day retention
- **Credential Rotation**: Every 90 days
- **Path-based isolation**: `client/`, `sync/`, `server/` enforce access boundaries
- **STS session policies**: Tenant-scoped, read-only, time-limited

## Client Implementations

| Service | Location |
|---------|----------|
| Python (Orchestrator) | `services/orchestrator/wasabi_client.py` |
| TypeScript (API) | `services/api/app/services/crsqlite_manager.py` |
| Edge Function (Upload) | `supabase/functions/captionacc-presigned-upload/` |

## Related Documentation

- [README.md](./README.md) - Storage paths and data flow
- [sqlite-databases.md](./sqlite-databases.md) - Database schemas
- [sync-protocol.md](./sync-protocol.md) - Wasabi upload triggers
- [../api-architecture/api-endpoints.md](../api-architecture/api-endpoints.md) - S3 credentials endpoint
