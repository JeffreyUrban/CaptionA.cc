# Wasabi Storage Security

## Architecture Overview

**Bucket:** `caption-acc-prod`

**Storage Path:** `{tenant_id}/{video_id}/{resource}`

**IAM Users:**
- `captionacc-app-readonly` - Web app (presigned URLs)
- `captionacc-orchestrator` - Video processing (uploads/deletes)

## Key Design Decisions

### 1. Split Credentials (Readonly vs Readwrite)

**Decision:** Web app uses read-only credentials, orchestrator uses read-write credentials.

**Why:**
- Web app only generates presigned URLs (read operations)
- Orchestrator needs upload/delete for video processing
- Credential leak limits blast radius to read-only or write-only

**Implementation:**
```bash
# Web app
WASABI_ACCESS_KEY_READONLY=...
WASABI_SECRET_KEY_READONLY=...

# Orchestrator
WASABI_ACCESS_KEY_READWRITE=...
WASABI_SECRET_KEY_READWRITE=...
```

### 2. Explicit DENY in IAM Policies

**Decision:** Policies include explicit DENY for non-app buckets.

**Why:**
- Wasabi account has multiple buckets (personal + app)
- DENY overrides any ALLOW, provides defense in depth
- Prevents lateral movement if credentials compromised

**See:** [wasabi-iam-policies/](./wasabi-iam-policies/)

### 3. Application-Level Tenant Isolation

**Decision:** Tenant isolation enforced in application code, not IAM policies.

**Why:**
- Wasabi doesn't fully support IAM policy variables like AWS
- Can't restrict IAM user to `{tenant_id}/*` dynamically
- RLS + application validation provides equivalent security

**Implementation:**
```typescript
// Always validate video belongs to tenant before S3 operation
const video = await supabase.from('videos')
  .select('tenant_id')
  .eq('id', videoId)
  .single()

if (video.tenant_id !== session.user.tenant_id) {
  throw new Error('Unauthorized')
}
```

### 4. Manual Credential Rotation (90 days)

**Decision:** Manual rotation every 90 days instead of automated.

**Why:**
- Only 2 credentials to manage
- Automation adds complexity without proportional security benefit
- Manual rotation takes ~10 minutes per quarter

**See:** [CREDENTIAL_ROTATION.md](./CREDENTIAL_ROTATION.md)

### 5. Tenant Quotas for Cost Control

**Decision:** Hard limits on storage per tenant.

**Limits:**
- 5 videos per tenant
- 100MB total storage
- 3 uploads per day

**Why:**
- Prevents runaway costs from single tenant
- Preview/beta protection
- Database quotas table enforces via RLS

**Implementation:** See `supabase/migrations/*_invite_codes_and_quotas.sql`

## Security Features

**Bucket-level:**
- ✅ Versioning enabled (recovery from accidental deletes)
- ✅ Access logging → `audit-logs-caption-acc` (90-day retention)
- ✅ Public access blocked
- ✅ Server-side encryption (Wasabi default)

**Configuration:** See `scripts/setup-wasabi-bucket.sh` for reproducible setup

**Application-level:**
- ✅ Presigned URLs (1-hour expiry)
- ✅ Tenant validation before all S3 ops
- ✅ Health checks (`/health` endpoint)
- ✅ RLS policies on database

## Testing

```bash
# Test both credential sets
./scripts/test-both-credentials.sh

# Test single credential set
source .env
./scripts/test-wasabi-access.sh
```

## Documentation

- **[IAM Policies](./wasabi-iam-policies/)** - Policy templates and setup instructions
- **[Bucket Configuration](./BUCKET_CONFIGURATION.md)** - Logging, lifecycle, and bucket setup
- **[Credential Rotation](./CREDENTIAL_ROTATION.md)** - Rotation process and schedule
- **[Repository Security](../REPO_SECURITY_SANITIZATION.md)** - What to commit/not commit

## Common Operations

**Rotate credentials:**
```bash
# See CREDENTIAL_ROTATION.md for full process
1. Generate new key in Wasabi Console
2. Update Fly.io secrets
3. Verify health checks
4. Wait 48h, delete old key
```

**Check access restrictions:**
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

**Re-apply bucket configuration:**
```bash
./scripts/wasabi-setup-bucket.sh
```
