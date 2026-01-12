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

Paths are organized by **access level** at the top, with `videos/` nested below:

```
caption-acc-prod/
└── {tenant_id}/
    ├── client/                          # Tenant-accessible via STS credentials
    │   └── videos/{video_id}/
    │       ├── video.mp4                # Original video
    │       ├── layout.db.gz             # CR-SQLite synced (use API for versioning)
    │       ├── captions.db.gz           # CR-SQLite synced (use API for versioning)
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
            ├── ocr-server.db            # Full OCR results
            └── layout-server.db         # ML model, analysis params
```

**Security principle:** Access level (`client/` vs `server/`) is at the top of the path hierarchy. This enables simple IAM policies without wildcards in the middle of the path.

## IAM Configuration

### IAM Users

| User | Purpose | Permissions |
|------|---------|-------------|
| `captionacc-app-readonly` | API presigned URLs | GetObject on `*/client/*` |
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
    "Resource": "arn:aws:s3:::caption-acc-prod/*/client/*"
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
    "Resource": "arn:aws:s3:::caption-acc-prod/{tenant_id}/client/*"
  }]
}
```

**Result:** Tenant can read all their `client/` content, but cannot:
- Write/upload anything
- Access other tenants' files
- Access `server/` proprietary files

## Client Access Methods

| Content | Access Method | Notes |
|---------|---------------|-------|
| Media (chunks, frames, video) | STS credentials | High volume, direct S3 access |
| Databases (layout.db.gz, captions.db.gz) | Presigned URL via API | Use API for version tracking |
| Server files | None | Never client-accessible |

**Note:** Databases are in `client/` and technically accessible via STS credentials, but clients should use the sync API's presigned URLs to ensure proper version tracking.

### STS Credentials Flow

```
1. Client calls Edge Function with JWT
2. Edge Function calls Wasabi STS AssumeRole with session policy
3. Returns temporary credentials scoped to tenant's client/ path
4. Client uses credentials directly with S3 SDK
5. All media requests go straight to Wasabi (no API round-trip)
```

### Presigned URL Flow (databases)

```
1. Client requests download URL via sync API
2. API generates presigned URL and tracks version
3. Client downloads directly from Wasabi
4. Presigned URL expires after 15 minutes
```

## Environment Variables

```bash
# Read-only credentials (API server - presigned URLs)
WASABI_ACCESS_KEY_READONLY=<key>
WASABI_SECRET_KEY_READONLY=<secret>

# Read-write credentials (orchestrator)
WASABI_ACCESS_KEY_READWRITE=<key>
WASABI_SECRET_KEY_READWRITE=<secret>

# STS assumer credentials (Edge Function)
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
- **Path-based isolation**: `client/` vs `server/` at top level for simple policies
- **STS session policies**: Tenant-scoped, read-only, time-limited

## Client Implementations

| Service | Location |
|---------|----------|
| Python (Orchestrator) | `services/orchestrator/wasabi_client.py` |
| TypeScript (API) | `services/api/app/services/crsqlite_manager.py` |
| Edge Function (Upload) | `supabase/functions/captionacc-presigned-upload/` |
| Edge Function (STS) | `supabase/functions/captionacc-s3-credentials/` |

## Related Documentation

- [README.md](./README.md) - Storage paths and data flow
- [sqlite-databases.md](./sqlite-databases.md) - Database schemas
- [sync-protocol.md](./sync-protocol.md) - Wasabi upload triggers
- [../api-architecture/api-endpoints.md](../api-architecture/api-endpoints.md) - S3 credentials endpoint
