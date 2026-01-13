# Preview Site Protection Guide

This guide covers the security and cost controls implemented for the preview/staging site.

## Protection Layers

### 1. Basic Authentication
- **Purpose:** Prevent casual discovery of preview site
- **Scope:** Entire site (before any app logic runs)
- **Implementation:** HTTP Basic Auth

### 2. Invite-Only Signup
- **Purpose:** Control who can create accounts
- **Scope:** User registration
- **Implementation:** Invite code validation

### 3. Resource Quotas
- **Purpose:** Prevent cost overruns from approved users
- **Scope:** Storage, processing, uploads
- **Implementation:** Database-enforced limits

### 4. User Approval
- **Purpose:** Secondary gate for manual review
- **Scope:** Feature access
- **Implementation:** approval_status check in RLS

## Quick Setup (Local Testing)

### Step 1: Apply Migration

```bash
# From project root
psql postgresql://postgres:<replace-with-db-password>@127.0.0.1:54322/postgres \
  -f supabase/migrations/20260106130000_invite_codes_and_quotas.sql
```

### Step 2: Generate Invite Codes

```sql
-- Connect to your database
psql postgresql://postgres:<replace-with-db-password>@127.0.0.1:54322/postgres

-- Generate an invite code
INSERT INTO invite_codes (
  code,
  created_by,
  max_uses,
  expires_at,
  notes
) VALUES (
  'PREVIEW-DEMO001',  -- Custom code or use random generation below
  (SELECT user_id FROM platform_admins WHERE admin_level = 'super_admin' LIMIT 1),
  1,  -- Single use
  NOW() + INTERVAL '30 days',
  'Test invite for preview site'
);

-- Or generate random code
INSERT INTO invite_codes (
  code,
  created_by,
  max_uses,
  expires_at,
  notes
) VALUES (
  'PREVIEW-' || upper(substr(md5(random()::text), 1, 8)),
  (SELECT user_id FROM platform_admins WHERE admin_level = 'super_admin' LIMIT 1),
  1,
  NOW() + INTERVAL '30 days',
  'Random invite code'
) RETURNING code;  -- Shows generated code

-- View all active invite codes
SELECT
  code,
  used_by,
  uses_count || '/' || max_uses as usage,
  CASE
    WHEN used_at IS NOT NULL THEN 'used'
    WHEN expires_at < NOW() THEN 'expired'
    ELSE 'active'
  END as status,
  notes,
  created_at
FROM invite_codes
ORDER BY created_at DESC;
```

### Step 3: Configure Basic Auth

```bash
# Add to .env.local (for local testing)
BASIC_AUTH_ENABLED=true
BASIC_AUTH_CREDENTIALS=preview:secret123

# For Fly.io preview
fly secrets set BASIC_AUTH_ENABLED=true
fly secrets set BASIC_AUTH_CREDENTIALS=preview:yoursecurepassword
```

### Step 4: Update Signup Flow

The signup flow needs to:
1. Accept invite code input
2. Validate code exists and is valid
3. Mark code as used
4. Auto-approve user (or mark as pending)

See implementation examples below.

## Default Quotas (Preview Site)

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Storage | 100MB | ~1-2 short videos, minimal cost |
| Video count | 5 videos | Enough for testing, not enough to abuse |
| Processing minutes | 30 min/month | ~3-5 videos processed |
| Daily uploads | 3 uploads/day | Prevents bulk uploads |

## Managing Invite Codes

### Generate Invite Code (SQL)

```sql
-- Single-use code
INSERT INTO invite_codes (code, created_by, max_uses, expires_at, notes)
SELECT
  'PREVIEW-' || upper(substr(md5(random()::text), 1, 8)),
  user_id,
  1,
  NOW() + INTERVAL '30 days',
  'Invite for John Doe'
FROM platform_admins
WHERE admin_level = 'super_admin'
LIMIT 1;

-- Multi-use code (for team)
INSERT INTO invite_codes (code, created_by, max_uses, expires_at, notes)
SELECT
  'TEAM-BETA-2025',
  user_id,
  10,  -- 10 uses
  NOW() + INTERVAL '90 days',
  'Beta team access'
FROM platform_admins
WHERE admin_level = 'super_admin'
LIMIT 1;

-- Unlimited code (expires by date only)
INSERT INTO invite_codes (code, created_by, max_uses, expires_at, notes)
SELECT
  'UNLIMITED-JAN',
  user_id,
  999999,
  NOW() + INTERVAL '31 days',
  'January unlimited access'
FROM platform_admins
WHERE admin_level = 'super_admin'
LIMIT 1;
```

### Revoke Invite Code

```sql
-- Expire a code immediately
UPDATE invite_codes
SET expires_at = NOW()
WHERE code = 'PREVIEW-ABC123';

-- Or delete it entirely
DELETE FROM invite_codes
WHERE code = 'PREVIEW-ABC123';
```

### Check Who Used a Code

```sql
SELECT
  ic.code,
  ic.notes,
  u.email as invited_user,
  up.approval_status,
  ic.used_at
FROM invite_codes ic
LEFT JOIN auth.users u ON ic.used_by = u.id
LEFT JOIN user_profiles up ON u.id = up.id
WHERE ic.code = 'PREVIEW-ABC123';
```

## Monitoring Usage

### Check Tenant Usage

```sql
-- Get usage for specific tenant
SELECT * FROM get_tenant_usage('tenant-uuid-here');

-- Find tenants approaching quotas
SELECT
  t.name,
  t.storage_quota_gb,
  COALESCE(SUM(v.size_bytes), 0) / 1073741824.0 as used_gb,
  COUNT(v.id) as video_count,
  t.video_count_limit
FROM tenants t
LEFT JOIN videos v ON t.id = v.tenant_id AND v.deleted_at IS NULL
GROUP BY t.id, t.name, t.storage_quota_gb, t.video_count_limit
HAVING COALESCE(SUM(v.size_bytes), 0) / 1073741824.0 > t.storage_quota_gb * 0.8
ORDER BY used_gb DESC;
```

### Check Today's Uploads

```sql
-- See all uploads today
SELECT
  t.name as tenant,
  du.upload_count,
  t.daily_upload_limit,
  du.total_bytes / 1048576.0 as mb_uploaded
FROM daily_uploads du
JOIN tenants t ON du.tenant_id = t.id
WHERE du.upload_date = CURRENT_DATE
ORDER BY du.upload_count DESC;
```

### Monitor High Users

```sql
-- Who's using the most storage?
SELECT
  t.name,
  u.email,
  COUNT(v.id) as videos,
  COALESCE(SUM(v.size_bytes), 0) / 1073741824.0 as gb_used,
  t.storage_quota_gb as quota_gb
FROM tenants t
JOIN user_profiles up ON t.id = up.tenant_id
JOIN auth.users u ON up.id = u.id
LEFT JOIN videos v ON t.id = v.tenant_id AND v.deleted_at IS NULL
GROUP BY t.id, t.name, u.email, t.storage_quota_gb
ORDER BY gb_used DESC
LIMIT 20;
```

## Quota Management

### Increase Quota for Specific Tenant

```sql
-- Give more storage to a trusted user
UPDATE tenants
SET storage_quota_gb = 1.0,  -- 1GB instead of 100MB
    video_count_limit = 20,
    processing_minutes_limit = 120
WHERE id = 'tenant-uuid-here';

-- Or by user email
UPDATE tenants
SET storage_quota_gb = 1.0
WHERE id IN (
  SELECT tenant_id FROM user_profiles up
  JOIN auth.users u ON up.id = u.id
  WHERE u.email = 'trusted@user.com'
);
```

### Reset Daily Limits

```sql
-- Daily limits reset automatically at midnight
-- But you can manually reset if needed
DELETE FROM daily_uploads
WHERE tenant_id = 'tenant-uuid-here'
  AND upload_date = CURRENT_DATE;
```

### Platform Admin Quotas

```sql
-- Platform admins might want higher limits for testing
UPDATE tenants
SET storage_quota_gb = 10.0,
    video_count_limit = 100,
    processing_minutes_limit = 500,
    daily_upload_limit = 50
WHERE id IN (
  SELECT tenant_id FROM user_profiles up
  JOIN platform_admins pa ON up.id = pa.user_id
  WHERE pa.revoked_at IS NULL
);
```

## Cost Alerts

### Set Up Daily Monitoring

```typescript
// Run this daily via cron or scheduled task
async function checkDailyUsage() {
  const usage = await supabase
    .rpc('get_total_storage_usage')

  const estimatedMonthlyCost =
    (usage.total_gb * 0.02) +  // Wasabi ~$0.02/GB
    (usage.processing_minutes * 0.05)  // Estimate $0.05/minute

  if (estimatedMonthlyCost > 50) {
    await sendAlert(`⚠️ Monthly estimate: $${estimatedMonthlyCost.toFixed(2)}`)

    // Optionally disable uploads
    if (estimatedMonthlyCost > 100) {
      await disableUploads()
    }
  }
}
```

### View Usage Trends

```sql
-- Storage growth over time
SELECT
  DATE(recorded_at) as date,
  SUM(metric_value) as total_gb
FROM usage_metrics
WHERE metric_type = 'storage_gb'
  AND recorded_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(recorded_at)
ORDER BY date;

-- Processing minutes per day
SELECT
  DATE(recorded_at) as date,
  SUM(metric_value) as processing_minutes,
  SUM(cost_estimate_usd) as estimated_cost
FROM usage_metrics
WHERE metric_type = 'processing_minutes'
  AND recorded_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(recorded_at)
ORDER BY date;
```

## Troubleshooting

### User Can't Upload Videos

**Check approval status:**
```sql
SELECT
  u.email,
  up.approval_status,
  up.invite_code_used,
  up.approved_at
FROM auth.users u
JOIN user_profiles up ON u.id = up.id
WHERE u.email = 'user@example.com';
```

**Check quotas:**
```sql
SELECT * FROM get_tenant_usage(
  (SELECT tenant_id FROM user_profiles WHERE id =
    (SELECT id FROM auth.users WHERE email = 'user@example.com'))
);
```

**Check if they hit daily limit:**
```sql
SELECT * FROM daily_uploads
WHERE tenant_id = (
  SELECT tenant_id FROM user_profiles WHERE id =
    (SELECT id FROM auth.users WHERE email = 'user@example.com')
)
AND upload_date = CURRENT_DATE;
```

### Invite Code Not Working

```sql
-- Check code status
SELECT
  code,
  uses_count,
  max_uses,
  expires_at,
  CASE
    WHEN uses_count >= max_uses THEN 'fully used'
    WHEN expires_at < NOW() THEN 'expired'
    ELSE 'valid'
  END as status
FROM invite_codes
WHERE code = 'PREVIEW-ABC123';
```

### User Needs More Quota

```sql
-- Check current usage
SELECT * FROM get_tenant_usage('tenant-uuid');

-- Increase if justified
UPDATE tenants
SET storage_quota_gb = storage_quota_gb + 0.5,  -- Add 500MB
    video_count_limit = video_count_limit + 5
WHERE id = 'tenant-uuid';
```

## Best Practices

### ✅ DO:

1. **Generate unique codes for each user**
   - Track who invited whom
   - Easy to revoke specific access

2. **Set expiration dates**
   - 30 days for most codes
   - 7 days for temporary access

3. **Monitor usage weekly**
   - Check who's using the most
   - Identify potential abuse early

4. **Start conservative**
   - 100MB is plenty for testing
   - Can always increase if needed

5. **Document each invite**
   - Who is it for?
   - Why are they getting access?
   - What are they testing?

### ❌ DON'T:

1. **Don't share multi-use codes publicly**
   - Creates uncontrolled access
   - Can't revoke for specific users

2. **Don't set unlimited quotas**
   - Even trusted users can misconfigure
   - Always have a ceiling

3. **Don't ignore quota warnings**
   - 80% usage is time to check in
   - 100% means someone's blocked

4. **Don't forget to revoke**
   - Expire codes after onboarding
   - Remove access for inactive users

## Emergency Procedures

### Disable All Uploads

```sql
-- Set all quotas to 0
UPDATE tenants SET daily_upload_limit = 0;

-- Or set feature flag
-- FEATURE_VIDEO_UPLOAD=false
```

### Lock Specific Tenant

```sql
UPDATE tenants
SET storage_quota_gb = 0,
    daily_upload_limit = 0
WHERE id = 'abusive-tenant-uuid';
```

### Bulk Delete Videos

```sql
-- Soft delete all videos for a tenant
UPDATE videos
SET deleted_at = NOW(),
    status = 'soft_deleted'
WHERE tenant_id = 'tenant-uuid';
```

## Migration to Production

When ready to launch:

1. **Disable basic auth** - No longer needed
2. **Keep invite system** - Or switch to email verification
3. **Increase quotas** - Based on pricing tiers
4. **Add billing** - Payment before quota increase
5. **Keep monitoring** - Even more important in production

See `docs/PRICING_TIERS.md` (TODO) for production quota recommendations.
