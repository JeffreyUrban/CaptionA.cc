# Platform Admin Guide

This document covers platform administration for CaptionA.cc, including user isolation, role management, and cross-tenant access for system administration.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Role Hierarchy](#role-hierarchy)
- [Granting Platform Admin Access](#granting-platform-admin-access)
- [User Isolation Model](#user-isolation-model)
- [Admin Operations](#admin-operations)
- [Security Best Practices](#security-best-practices)
- [Future Features](#future-features)

---

## Architecture Overview

CaptionA.cc has a **two-tier role system**:

1. **Platform Roles** - System-wide administrative access
   - Stored in `platform_admins` table
   - Bypass tenant boundaries
   - Used for support and system management

2. **Tenant Roles** - Workspace-specific access
   - Stored in `user_profiles.role`
   - Scoped to a single tenant
   - Used for normal user operations

### Current Implementation Status

**✅ Implemented:**
- Platform admins table and RLS policies
- Tenant-level user isolation (owner vs member)
- Protected admin routes (/admin and /api/admin/*)
- Helper functions for role checks
- Audit logging infrastructure

**📋 Not Yet Built (Documented for Future):**
- Admin portal UI for tenant management
- User impersonation feature
- Automatic tenant creation on signup
- Cross-tenant search/analytics
- Support ticket integration

---

## Role Hierarchy

```
Platform Level (Cross-Tenant):
├── super_admin - Full system access, can do anything
└── support - Read-only access for customer support

Tenant Level (Workspace-Scoped):
├── owner - Tenant administrator, full control within tenant
└── member - Regular user, can only access their own videos
```

### Role Capabilities

| Operation | Member (B2C) | Member (B2B) | Owner | Platform Admin | Support |
|-----------|-------------|-------------|-------|----------------|---------|
| Upload videos | ✅ Own tenant | ✅ Own tenant | ✅ Own tenant | ✅ Any tenant | ❌ |
| View own videos | ✅ | ✅ | ✅ | ✅ Any | ✅ Any (read-only) |
| View others' videos | ❌ N/A | ❌ | ✅ Tenant-wide | ✅ Any tenant | ✅ Any (read-only) |
| Edit own annotations | ✅ | ✅ | ✅ | ✅ Any | ❌ |
| Edit others' annotations | ❌ N/A | ❌ | ✅ Tenant-wide | ✅ Any tenant | ❌ |
| Soft delete own videos | ✅ | ✅ | ✅ | ✅ Any | ❌ |
| Soft delete others' videos | ❌ N/A | ❌ | ✅ Tenant-wide | ✅ Any tenant | ❌ |
| Purge permanently | ❌ | ❌ | ❌ | ✅ Any tenant | ❌ |
| Manage tenant settings | ✅ (Own) | ❌ | ✅ | ✅ Any tenant | ❌ |
| Invite users to tenant | N/A | ❌ | ✅ | ✅ Any tenant | ❌ |
| View tenant quotas | ✅ (Own) | ❌ | ✅ | ✅ Any tenant | ✅ Any (read-only) |
| Adjust tenant quotas | ❌ | ❌ | ❌ | ✅ | ❌ |
| Access /admin page | ❌ | ❌ | ❌ | ✅ | ⚠️ Limited |

---

## Granting Platform Admin Access

Platform admin access must be granted manually via psql or Supabase Studio. This is intentional for security - there is no UI to self-promote to admin.

### Method 1: Via psql (Recommended)

```bash
# Connect to your Supabase database
psql postgresql://postgres:<replace-with-db-password>@localhost:54322/postgres

# Or for production:
# psql postgresql://postgres.[PROJECT-REF].supabase.co:5432/postgres
```

```sql
-- Grant super_admin access to a user
-- Replace '<user-uuid>' with the actual user ID from auth.users
INSERT INTO captionacc_production.platform_admins (
  user_id,
  admin_level,
  granted_by,
  notes
) VALUES (
  '<user-uuid>',
  'super_admin',
  NULL,  -- NULL for first admin, or UUID of admin who granted access
  'Initial platform admin - granted manually'
);

-- Verify the grant
SELECT
  pa.user_id,
  pa.admin_level,
  pa.granted_at,
  pa.notes,
  au.email
FROM platform_admins pa
JOIN auth.users au ON pa.user_id = au.id
WHERE pa.revoked_at IS NULL;
```

### Method 2: Via Supabase Studio

1. Navigate to http://localhost:54323 (or your Supabase Studio URL)
2. Go to **Table Editor** → **platform_admins**
3. Click **Insert row**
4. Fill in:
   - `user_id`: UUID from auth.users (copy from Authentication → Users)
   - `admin_level`: `super_admin` or `support`
   - `notes`: Why this person is being granted admin access
5. Leave `granted_by`, `granted_at`, `revoked_at` as default/NULL

### Getting Your User ID

If you don't know your user ID:

```sql
-- Find your user ID by email
SELECT id, email, created_at
FROM auth.users
WHERE email = 'your-email@example.com';
```

Or check in Supabase Studio:
- **Authentication** → **Users** → Find your email → Copy the ID

### Granting Support Access

For read-only support staff:

```sql
INSERT INTO captionacc_production.platform_admins (
  user_id,
  admin_level,
  granted_by,
  notes
) VALUES (
  '<support-user-uuid>',
  'support',
  '<your-super-admin-uuid>',
  'Customer support access - read-only'
);
```

### Revoking Platform Admin Access

To revoke access without deleting the record (for audit purposes):

```sql
UPDATE captionacc_production.platform_admins
SET revoked_at = NOW()
WHERE user_id = '<user-uuid>';
```

---

## User Isolation Model

### Current Implementation (B2C with 1:1 Tenancy)

**Tenant Creation:**
- Each user gets their own tenant (1 user = 1 tenant)
- Tenant is created automatically on signup (TODO: implement in signup flow)
- User is automatically assigned as `owner` of their tenant

**Isolation:**
- `owner` can see all videos in their tenant (only their own in B2C)
- `member` role is dormant (no multi-user tenants yet)
- Platform admins bypass isolation for support/debugging

### Row Level Security (RLS)

All tables have RLS enabled. Key policies:

**Videos Table:**
```sql
-- Members can only see their own videos
CREATE POLICY "Members view own videos"
  ON videos FOR SELECT
  USING (uploaded_by_user_id = auth.uid() AND deleted_at IS NULL);

-- Owners can see all videos in their tenant
CREATE POLICY "Owners view tenant videos"
  ON videos FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM user_profiles
    WHERE id = auth.uid() AND role = 'owner'
  ) AND deleted_at IS NULL);

-- Platform admins can see everything
CREATE POLICY "Platform admins view all videos"
  ON videos FOR SELECT
  USING (is_platform_admin());
```

**Helper Functions:**
- `is_platform_admin()` - Returns true if current user is active platform admin
- `is_tenant_owner(tenant_uuid)` - Returns true if user is owner of specified tenant
- `current_user_tenant_id()` - Returns tenant_id for current user

### Service Role vs Platform Admin

**Service Role:**
- Used by Prefect flows and system processes
- Bypasses ALL RLS policies
- No audit logging (system operations)
- Never exposed to frontend

**Platform Admin:**
- Used by humans for administration
- Bypasses RLS via explicit policies
- All actions logged in `platform_admin_audit` table
- Accessed through authenticated frontend

---

## Admin Operations

### Current Admin Page Features

The `/admin` page provides:
- **Database Administration**
  - Schema version monitoring
  - Database repair/migration
  - Detect schema drift
- **Failed Video Recovery**
  - List videos with failed processing
  - Retry processing for specific videos
- **Model Version Checks**
  - Verify all videos use current model version
  - Trigger recalculation for outdated videos

### Audit Logging

All platform admin actions are logged in `platform_admin_audit`:

```sql
-- View recent admin actions
SELECT
  pa.email as admin_email,
  pal.action,
  pal.resource_type,
  pal.target_tenant_id,
  pal.created_at
FROM platform_admin_audit pal
JOIN auth.users pa ON pal.admin_user_id = pa.id
ORDER BY pal.created_at DESC
LIMIT 50;
```

**Important:** The audit logging is set up but not yet integrated into all admin operations. TODO: Add audit logging to admin actions.

### Common Admin Tasks

**View all tenants:**
```sql
SELECT
  t.id,
  t.name,
  t.slug,
  t.storage_quota_gb,
  COUNT(v.id) as video_count,
  SUM(v.size_bytes) / 1073741824.0 as storage_gb_used
FROM tenants t
LEFT JOIN videos v ON t.id = v.tenant_id AND v.deleted_at IS NULL
GROUP BY t.id
ORDER BY t.created_at DESC;
```

**Find videos by user:**
```sql
SELECT
  v.id,
  v.filename,
  v.status,
  v.uploaded_at,
  u.email as uploaded_by
FROM videos v
JOIN auth.users u ON v.uploaded_by_user_id = u.id
WHERE u.email = 'user@example.com'
ORDER BY v.uploaded_at DESC;
```

**Check user's tenant and role:**
```sql
SELECT
  u.email,
  up.role as tenant_role,
  t.name as tenant_name,
  pa.admin_level as platform_role
FROM auth.users u
JOIN user_profiles up ON u.id = up.id
JOIN tenants t ON up.tenant_id = t.id
LEFT JOIN platform_admins pa ON u.id = pa.user_id AND pa.revoked_at IS NULL
WHERE u.email = 'user@example.com';
```

---

## Security Best Practices

### DO:

✅ **Limit platform admin count**
- Keep platform admins to 2-5 people maximum
- Use `support` role for most support staff (read-only)

✅ **Require MFA for platform admins**
- Configure in Supabase Auth settings
- Consider requiring hardware keys (Yubikey)

✅ **Review audit logs regularly**
```sql
-- Check for unusual activity
SELECT
  admin_user_id,
  COUNT(*) as action_count,
  MAX(created_at) as last_action
FROM platform_admin_audit
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY admin_user_id
ORDER BY action_count DESC;
```

✅ **Use separate admin portal/subdomain**
- Consider moving admin features to `admin.captionacc.com`
- Clear separation between user and admin interfaces

✅ **Grant platform admin via secure channel**
- Never expose a "make me admin" button
- Manual database insert only
- Require approval from existing super_admin

### DON'T:

❌ **Don't use service role for human actions**
- Service role has no audit trail
- Use platform admin with proper logging instead

❌ **Don't store platform admin credentials in code**
- User-based authentication only
- No hardcoded admin passwords

❌ **Don't skip audit logging**
- Every admin action should be logged
- Especially: viewing sensitive data, modifying quotas, deleting content

❌ **Don't allow platform admins to delete audit logs**
- Audit table should be append-only
- Consider exporting to external log aggregation system

❌ **Don't grant platform admin liberally**
- Each admin is a security risk
- Consider time-limited access (revoke after project completes)

---

## Future Features

These features are architecturally supported but not yet implemented:

### 1. User Impersonation

**Purpose:** Debug issues by seeing what users see

**Implementation Plan:**
```typescript
// Admin endpoint to generate impersonation token
POST /api/admin/impersonate
{
  "targetUserId": "uuid",
  "reason": "Debugging issue #1234",
  "durationMinutes": 15
}

// Returns:
{
  "impersonationToken": "...",
  "expiresAt": "2025-01-06T12:15:00Z"
}

// Token includes metadata:
{
  actual_user_id: "admin-uuid",
  impersonating_user_id: "user-uuid",
  impersonation_started_at: "...",
  expires_at: "...",
  reason: "Debugging issue #1234"
}

// All actions while impersonating are logged in platform_admin_audit
```

**Security:**
- Time-limited (max 30 minutes)
- Logged in audit trail
- User can be notified: "Admin XYZ accessed your account for support"

### 2. Tenant Management UI

**Features:**
- List all tenants with stats
- Search by tenant name, user email
- View tenant quota usage
- Adjust storage quotas
- View tenant activity timeline

**Routes:**
```
/admin/tenants              - List all tenants
/admin/tenants/:id          - Tenant details
/admin/tenants/:id/users    - Users in tenant
/admin/tenants/:id/videos   - Videos in tenant
/admin/tenants/:id/settings - Adjust quotas, settings
```

### 3. Automatic Tenant Creation on Signup

**Signup Flow:**
```typescript
// When user signs up:
1. Create auth.users entry (Supabase Auth)
2. Create tenant with slug = user.id
3. Create user_profile with:
   - tenant_id = new tenant
   - role = 'owner'
   - full_name from signup metadata

// Use Supabase Auth trigger or handle in signup endpoint
```

### 4. Multi-User Tenants (B2B)

**When ready for teams:**
- Add invitation system (use Supabase Auth built-in invites)
- Allow users to invite others to their tenant
- Invited users default to `member` role
- Owners can promote members to owner

**UI Flow:**
```
/settings/team                     - Team management
/settings/team/invite              - Invite form
/settings/team/members/:id/edit    - Edit member role
```

### 5. Cross-Tenant Analytics

**Admin analytics:**
- Total users, tenants, videos
- Storage usage trends
- Processing stats (failed videos, avg processing time)
- User cohorts (signup trends, retention)

**Privacy:** Only aggregated data, not individual user content

### 6. API Keys for Programmatic Access

**Use Case:** CLI tools, automation, CI/CD

```sql
CREATE TABLE tenant_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  key_hash TEXT NOT NULL, -- bcrypt hash of API key
  key_prefix TEXT, -- First 8 chars for identification
  scopes TEXT[], -- ['video:read', 'video:write', etc.]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
```

---

## Troubleshooting

### "Forbidden: Platform admin access required" when accessing /admin

**Cause:** You're not in the `platform_admins` table

**Solution:**
1. Check if you're a platform admin:
   ```sql
   SELECT * FROM platform_admins
   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your@email.com')
   AND revoked_at IS NULL;
   ```
2. If no results, follow [Granting Platform Admin Access](#granting-platform-admin-access)

### Can see own videos but not other users' videos (as owner)

**Cause:** Role might not be set to `owner`

**Check:**
```sql
SELECT role FROM user_profiles WHERE id = auth.uid();
```

**Fix:**
```sql
UPDATE user_profiles SET role = 'owner'
WHERE id = '<your-user-uuid>';
```

### Platform admin can't see videos

**Cause 1:** RLS policies might not be applied yet

**Check migration status:**
```bash
cd supabase
supabase db diff
```

**Apply migration:**
```bash
supabase db push
```

**Cause 2:** Platform admin record has `revoked_at` set

**Check:**
```sql
SELECT * FROM platform_admins WHERE user_id = '<your-uuid>';
```

**Fix:**
```sql
UPDATE platform_admins
SET revoked_at = NULL
WHERE user_id = '<your-uuid>';
```

---

## Migration Checklist

When migrating from old role system:

- [ ] Apply migration: `20260106120000_platform_admin_and_user_isolation.sql`
- [ ] Grant yourself platform admin access via psql
- [ ] Verify you can access `/admin` page
- [ ] Update any custom queries that reference old roles (`admin`, `user`, `annotator`)
- [ ] Test video visibility as different roles
- [ ] Check that RLS policies work in Supabase Studio SQL Editor
- [ ] Update Python services to use new role names (`owner`, `member`)

---

## Support

For questions or issues with platform admin features:
- Check [Supabase Setup Guide](../supabase/docs/SUPABASE_SETUP.md)
- Review RLS policies in migration file
- Check audit logs for platform admin actions
- Open issue on GitHub with `[admin]` prefix
