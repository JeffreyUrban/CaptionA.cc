# Security Architecture

## Overview

CaptionA.cc implements a defense-in-depth security architecture for multi-tenant B2C SaaS. This document explains how we achieve tenant isolation, secure credential management, and threat detection.

**Key Principle**: Shared application credentials with path-based + RLS isolation, not per-tenant credentials.

## Table of Contents

- [Multi-Tenant Isolation Model](#multi-tenant-isolation-model)
- [Credential Management](#credential-management)
- [Authentication & Authorization](#authentication--authorization)
- [Security Monitoring](#security-monitoring)
- [Defense-in-Depth Layers](#defense-in-depth-layers)
- [Threat Model & Mitigations](#threat-model--mitigations)

---

## Multi-Tenant Isolation Model

### Architecture Choice: Shared Credentials

We use **shared application credentials** rather than per-tenant credentials. This is the industry-standard approach for B2C SaaS and is used by Stripe, Vercel, GitHub, and similar platforms.

**Why shared credentials are secure:**

1. **Path-based isolation in object storage**
   - All tenant data stored at: `{tenant_id}/{video_id}/{resource}`
   - Application code enforces tenant boundary checks
   - Example: `00000000-0000-0000-0000-000000000001/a4f2b8c3.../video.mp4`

2. **Row-Level Security (RLS) in Supabase**
   - Database enforces tenant isolation at query level
   - Users can only SELECT/UPDATE/DELETE their own tenant's rows
   - Multiple policies: members see own videos, owners see all tenant videos
   - Platform admins have cross-tenant access for support

3. **Server-side credential access only**
   - Credentials never exposed to browser/client code
   - All storage access uses server-generated signed URLs
   - Short-lived URLs (1-hour expiry) scoped to specific objects

### Per-Tenant Credentials: Why We Don't Need Them

**Operational burden of per-tenant credentials:**
- Managing 1,000+ IAM users at scale
- Complex credential rotation (1,000 rotations vs 2)
- Debugging failures across tenants
- May incur per-IAM-user costs from cloud providers

**Minimal security gain:**
- If backend is compromised, attacker has server access regardless
- RLS + path isolation already prevents cross-tenant data access
- Main risk is application bugs (per-tenant creds don't fix this)

**When you would need per-tenant credentials:**
- Enterprise compliance requirements (SOC2 Type II, FedRAMP, HIPAA)
- Cloud-level cost tracking per tenant
- Ability to disable one tenant's storage without code changes

---

## Credential Management

### Current Credentials

All credentials are **application-level, shared across tenants**:

| Credential | Purpose | Scope | Stored In |
|------------|---------|-------|-----------|
| Wasabi READ-ONLY | Browser signed URL generation | Shared | Fly.io Secrets |
| Wasabi READ-WRITE | Service uploads/downloads | Shared | Fly.io Secrets |
| Supabase Service Role | Database access with RLS | Shared | Fly.io Secrets |
| Deepgram API | Speech-to-text processing | Shared | Fly.io Secrets |
| Prefect API | Workflow orchestration | Shared | Fly.io Secrets |

### Two-Credential Wasabi Model

**READ-ONLY credentials** (`WASABI_ACCESS_KEY_READONLY`):
- Used by web application to generate presigned URLs
- Browser downloads frames directly from Wasabi (no server proxy)
- Principle of least privilege: cannot modify/delete objects
- IAM policy: `captionacc-app-readonly` (GetObject only)

**READ-WRITE credentials** (`WASABI_ACCESS_KEY_READWRITE`):
- Used by orchestrator service for video processing
- Can upload videos, chunks, databases
- IAM policy: `captionacc-orchestrator` (full access to bucket)

### Secret Storage: Fly.io Secrets

Credentials stored as Fly.io secrets (encrypted at rest):

```bash
fly secrets set \
  WASABI_ACCESS_KEY_READONLY="..." \
  WASABI_SECRET_KEY_READONLY="..." \
  WASABI_ACCESS_KEY_READWRITE="..." \
  WASABI_SECRET_KEY_READWRITE="..."
```

**Advantages over environment variables:**
- Encrypted at rest and in transit
- Not visible in process listings
- Audit log of secret changes
- Automatic rotation support
- No accidental commits to version control

**Future enhancement: Supabase Vault**
- Could move to Supabase Vault for centralized secret management
- Provides audit logging of secret access
- Supports secret versioning and rotation
- See [Supabase Vault Integration](#supabase-vault-integration-optional)

---

## Authentication & Authorization

### Authentication Flow

1. **User authenticates** with Supabase Auth (email/password, OAuth, magic link)
2. **JWT issued** with user.id claim
3. **Middleware extracts user** from JWT (`requireAuth()`)
4. **User profile fetched** to get `tenant_id`, `role`, `approval_status`
5. **Approval check**: Only approved users can access resources

**Audit logging**: All auth events logged to `security_audit_log`

```typescript
// Authentication with audit logging
export async function requireAuth(request: Request): Promise<AuthContext> {
  const { user, error } = await supabase.auth.getUser()

  if (error || !user) {
    await logAuthFailure(request, error?.message)
    throw new Response('Unauthorized', { status: 401 })
  }

  const profile = await getProfile(user.id)

  if (!profile || profile.approval_status !== 'approved') {
    await logAuthFailure(request, 'Not approved')
    throw new Response('Forbidden', { status: 403 })
  }

  await logAuthSuccess(request, user.id, profile.tenant_id)

  return { user, userId: user.id, tenantId: profile.tenant_id, role: profile.role }
}
```

### Authorization: Video Ownership

Authorization checks enforce tenant boundaries and ownership:

```typescript
export async function requireVideoOwnership(
  authContext: AuthContext,
  videoId: string,
  request?: Request
): Promise<void> {
  // Platform admins bypass checks
  if (authContext.isPlatformAdmin) return

  const video = await getVideo(videoId)

  const isOwner = video.uploaded_by_user_id === authContext.userId
  const isTenantOwner = authContext.role === 'owner' && video.tenant_id === authContext.tenantId

  if (!isOwner && !isTenantOwner) {
    // CRITICAL: Detect cross-tenant access attempt
    if (video.tenant_id !== authContext.tenantId) {
      await logCrossTenantAttempt(
        request,
        authContext.userId,
        authContext.tenantId,
        video.tenant_id,
        'video',
        videoId
      )
    } else {
      await logAuthzFailure(request, authContext.userId, 'Not video owner')
    }

    throw new Response('Forbidden', { status: 403 })
  }
}
```

**Cross-tenant detection**: Immediately logs CRITICAL event if user from tenant A attempts to access tenant B's video.

### Access Tiers

Feature access controlled by tier system (separate from billing):

| Tier | Max Videos | Storage | Annotation | Upload | Export | Demo Videos |
|------|------------|---------|------------|--------|--------|-------------|
| demo | 0 | 0 GB | ❌ | ❌ | ❌ | ✅ |
| trial | 3 | 1 GB | ✅ (first 3) | ✅ | ✅ | ✅ |
| active | 1000 | 100 GB | ✅ | ✅ | ✅ | ✅ |

**Implementation**: RLS policies check `has_feature_access()` function.

---

## Security Monitoring

### Audit Log

All security events logged to `security_audit_log` table:

**Event types**:
- `auth_success` - Successful authentication
- `auth_failure` - Failed authentication attempt
- `authz_failure` - Authenticated but not authorized
- `cross_tenant_attempt` - **CRITICAL** - Cross-tenant access attempt
- `suspicious_activity` - Unusual patterns detected

**Severity levels**:
- `info` - Normal operations (auth success)
- `warning` - Review recommended (auth failure, authz failure)
- `critical` - Immediate attention (cross-tenant attempts)

### Detection Functions

**Repeated cross-tenant attacks**:

```sql
SELECT * FROM detect_repeated_cross_tenant_attempts(
  threshold => 5,     -- 5+ attempts
  minutes_back => 15  -- in last 15 minutes
);
```

Returns users making repeated cross-tenant access attempts (potential attacker).

**Critical events**:

```sql
SELECT * FROM get_critical_security_events(hours_back => 24);
```

Returns all critical security events for alerting.

**User risk score**:

```sql
SELECT * FROM get_user_security_summary(user_id);
```

Returns user's security history and calculated risk score (0-100).

### Monitoring Dashboard

Platform admins can access security monitoring at `/api/admin/security`:

```bash
# Critical events (last 24 hours)
GET /api/admin/security?view=critical&hours=24

# Detect repeated attacks (last 15 minutes)
GET /api/admin/security?view=attacks&minutes=15

# Recent events (all severities)
GET /api/admin/security?view=recent

# Aggregated metrics by hour
GET /api/admin/security?view=metrics

# User security summary
GET /api/admin/security?view=user&userId=<uuid>
```

---

## Defense-in-Depth Layers

### Layer 1: Network (Fly.io)

- **TLS encryption** for all connections
- **IP allowlisting** (optional - via Fly.io firewall)
- **DDoS protection** (Fly.io edge network)
- **Rate limiting** (Fly.io + application level)

### Layer 2: Authentication (Supabase Auth)

- **JWT-based authentication** with secure session management
- **Password hashing** (bcrypt with automatic salt)
- **MFA support** (TOTP, SMS)
- **OAuth providers** (Google, GitHub, etc.)
- **Magic links** (email-based passwordless auth)

### Layer 3: Application (Middleware)

- **requireAuth()** - Validates JWT, checks approval status
- **requireVideoOwnership()** - Enforces ownership before modifications
- **Audit logging** - All auth/authz events logged
- **Input validation** - Sanitize all user inputs
- **CORS policies** - Restrict cross-origin requests

### Layer 4: Database (RLS Policies)

**Ultimate security enforcer** - Even if application has bugs, RLS prevents cross-tenant access:

```sql
-- Members can only see their own videos
CREATE POLICY "Members view own videos"
  ON videos FOR SELECT
  USING (uploaded_by_user_id = auth.uid() AND deleted_at IS NULL);

-- Owners can see all videos in their tenant
CREATE POLICY "Owners view tenant videos"
  ON videos FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
    AND deleted_at IS NULL
  );

-- Platform admins see everything (for support)
CREATE POLICY "Platform admins view all videos"
  ON videos FOR SELECT
  USING (is_platform_admin());
```

### Layer 5: Object Storage (Wasabi Bucket Policies)

**Bucket policies** enforce path prefixes at storage level:

```json
{
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::caption-acc-prod/*"
  }]
}
```

**Future enhancement**: Restrict prefixes per IAM user (defense-in-depth).

### Layer 6: Monitoring & Alerting

- **Security audit log** - All events in database
- **Critical event detection** - Automated queries for threats
- **Attack pattern detection** - Repeated cross-tenant attempts
- **Admin dashboard** - Real-time security metrics
- **Alerting** (future) - Slack/email/PagerDuty for critical events

---

## Threat Model & Mitigations

### Threat: Cross-Tenant Data Access

**Attack**: Malicious user attempts to access another tenant's videos by guessing UUIDs.

**Mitigations**:
1. ✅ **RLS policies** - Database blocks query even if application allows
2. ✅ **Application auth** - `requireVideoOwnership()` blocks before query
3. ✅ **Audit logging** - Cross-tenant attempt logged as CRITICAL event
4. ✅ **UUIDs** - Unguessable resource identifiers (not sequential IDs)
5. ✅ **Monitoring** - Repeated attempts detected and flagged

**Detection**: Real-time via `logCrossTenantAttempt()` + `detect_repeated_cross_tenant_attempts()`.

### Threat: Credential Exposure

**Attack**: Wasabi credentials leaked via environment variables or logs.

**Mitigations**:
1. ✅ **Fly.io Secrets** - Encrypted storage, not in process listings
2. ✅ **Server-side only** - Credentials never sent to browser
3. ✅ **READ-ONLY for web app** - Principle of least privilege
4. ✅ **Signed URLs** - Short-lived (1 hour), scoped to specific objects
5. ✅ **No logging** - Credentials excluded from application logs
6. ⏳ **Vault migration** (optional) - Move to Supabase Vault for rotation + audit

**Rotation**: Manual rotation via Fly.io CLI:

```bash
# Generate new keys in Wasabi console
# Update Fly.io secrets
fly secrets set WASABI_ACCESS_KEY_READONLY="new_key"
fly secrets set WASABI_SECRET_KEY_READONLY="new_secret"

# Redeploy application
fly deploy
```

### Threat: SQL Injection

**Attack**: Malicious SQL in user inputs to bypass RLS or exfiltrate data.

**Mitigations**:
1. ✅ **Parameterized queries** - Supabase client uses prepared statements
2. ✅ **Input validation** - Server-side validation of all inputs
3. ✅ **RLS enforcement** - Even injected SQL constrained by RLS
4. ✅ **Least privilege** - Application uses service role, not postgres user

**Example**:
```typescript
// SAFE - Parameterized query
await supabase.from('videos').select('*').eq('id', videoId)

// UNSAFE - String interpolation (never do this)
await supabase.raw(`SELECT * FROM videos WHERE id = '${videoId}'`)
```

### Threat: Authentication Bypass

**Attack**: Attacker attempts to bypass JWT validation or approval checks.

**Mitigations**:
1. ✅ **Supabase Auth** - Industry-standard JWT validation
2. ✅ **Approval status check** - Middleware enforces before resource access
3. ✅ **Session expiry** - JWTs expire after 1 hour
4. ✅ **Audit logging** - All auth failures logged
5. ✅ **RLS fallback** - Database enforces auth even if middleware bypassed

### Threat: Denial of Service (DoS)

**Attack**: Excessive upload attempts to exhaust storage quota or processing resources.

**Mitigations**:
1. ✅ **Storage quotas** - Per-tenant limits enforced (100MB for trial, 100GB for active)
2. ✅ **Daily upload limits** - Max uploads per day per tenant
3. ✅ **Video count limits** - Max number of videos per tenant
4. ✅ **Fly.io rate limiting** - Edge network blocks abusive traffic
5. ✅ **Prefect flow limits** - Max concurrent processing jobs
6. ✅ **Approval required** - Only approved users can upload

**Implementation**: `can_upload_video()` function checks all quotas before allowing upload.

---

## Migration Path: Supabase Vault Integration (Optional)

### Current: Fly.io Secrets

```bash
# Credentials in Fly.io encrypted secrets
WASABI_ACCESS_KEY_READONLY=...
WASABI_SECRET_KEY_READONLY=...
```

```typescript
// Application reads from environment
const accessKey = process.env.WASABI_ACCESS_KEY_READONLY
```

### Future: Supabase Vault

**Step 1**: Create vault secrets

```sql
-- Store secrets in Supabase Vault
SELECT vault.create_secret(
  'WASABI_ACCESS_KEY_READONLY',
  'SNAX2WPJAV4OGXCN4HEC'
);

SELECT vault.create_secret(
  'WASABI_SECRET_KEY_READONLY',
  '9K26uuzEoN3AQsjgGHZVerCuHmmf7BLwht5Mo0wF'
);
```

**Step 2**: Read secrets in application

```typescript
// Read from Supabase Vault instead of environment
const { data } = await supabase.rpc('vault.read_secret', {
  secret_name: 'WASABI_ACCESS_KEY_READONLY'
})
const accessKey = data.secret
```

**Benefits**:
- ✅ **Audit logging** - Track every secret access
- ✅ **Versioning** - Rotate secrets without downtime
- ✅ **Centralized** - Single source of truth for all services
- ✅ **Encryption at rest** - Managed by Supabase
- ✅ **Fine-grained access** - RLS policies on vault access

**Trade-offs**:
- ⚠️ **Dependency** - Application requires database connection to boot
- ⚠️ **Latency** - Secret reads add database round-trip
- ⚠️ **Complexity** - Additional abstraction layer

**Recommendation**: Migrate only if audit logging or secret rotation becomes critical requirement.

---

## Security Checklist

### Development

- [ ] Never commit credentials to version control
- [ ] Use `.env` files for local development only
- [ ] Validate all user inputs server-side
- [ ] Use parameterized queries (no string interpolation)
- [ ] Test RLS policies with different user roles
- [ ] Review audit logs during testing

### Deployment

- [ ] Store all credentials in Fly.io Secrets
- [ ] Enable RLS on all new tables
- [ ] Create RLS policies before inserting data
- [ ] Test cross-tenant isolation in staging
- [ ] Review security audit logs weekly
- [ ] Set up alerting for critical events

### Operations

- [ ] Rotate credentials quarterly
- [ ] Review platform admin list monthly
- [ ] Audit security logs for anomalies
- [ ] Test incident response procedures
- [ ] Keep dependencies updated (npm audit, pip-audit)
- [ ] Review and update this document quarterly

---

## Security Contacts

**Security Issues**: Report to platform administrators

**Vulnerability Disclosure**: Follow responsible disclosure practices

**Security Reviews**: Quarterly reviews by platform admin team

**Compliance**: Document maintained for SOC2/ISO27001 readiness

---

## References

- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Fly.io Secrets Management](https://fly.io/docs/reference/secrets/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Wasabi IAM Policies](../data-architecture/wasabi/wasabi-iam-policies/README.md)
- [Multi-Schema Setup](supabase/MULTI_SCHEMA_SETUP.md)
- [Access Control System](USER_ACCESS_CONTROL.md)

---

**Last Updated**: 2026-01-07
**Version**: 1.0
**Maintained By**: Platform Admin Team
