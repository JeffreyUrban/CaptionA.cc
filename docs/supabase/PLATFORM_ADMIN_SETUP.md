# Platform Admin Setup - Quick Start

This guide walks you through setting up the database schema and granting yourself platform admin access.

## Prerequisites

- Two separate Supabase projects (prod and dev)
- Access to Supabase SQL Editor for both projects

## Environment Strategy

| Environment | Supabase Project | Schema Name |
|-------------|------------------|-------------|
| Production  | (your prod project) | `captionacc` |
| Development | (your dev project)  | `captionacc` |

Both environments use the same schema name (`captionacc`) but in separate Supabase projects. This provides complete data isolation while keeping the codebase simple.

## Step 1: Create the Schema

Run the migration in **both** Supabase projects via SQL Editor.

**File:** `supabase/migrations/20260121000000_captionacc_schema.sql`

Copy the entire contents and run in:
1. Your **production** Supabase project SQL Editor
2. Your **development** Supabase project SQL Editor

This creates:
- All tables (tenants, user_profiles, videos, platform_admins, etc.)
- RLS policies for security
- Helper functions
- Seed data (access tiers)
- Auth trigger for auto-creating user profiles on signup

## Step 2: Set Up Admin User

Run the admin setup script in **both** Supabase projects:

**File:** `supabase/scripts/setup_admin.sql`

1. Open the script and replace `your@email.com` with your actual email
2. Run Step 1 to create the tenant and find your user UUID
3. Copy your UUID from the output
4. Replace all `YOUR-UUID-HERE` placeholders with your actual UUID
5. Run Steps 2-4 to complete setup

The script creates:
- Default tenant
- Your user profile (owner role, approved, active tier)
- Platform admin access (super_admin)

## Verify Setup

After running the script, you should see output like:

```
email            | tenant  | tenant_slug | role  | approval_status | access_tier_id | platform_admin
your@email.com   | Default | default     | owner | approved        | active         | super_admin
```

## Role System Overview

### Platform Level (Cross-Tenant)

| Role | Access |
|------|--------|
| `super_admin` | Full system access across all tenants |
| `support` | Read-only access for customer support |

### Tenant Level (Single Workspace)

| Role | Access |
|------|--------|
| `owner` | Full control within their tenant |
| `member` | Access to their own resources only |

### Access Tiers

| Tier | Description |
|------|-------------|
| `demo` | Read-only access to demo videos |
| `trial` | Upload up to 3 videos |
| `active` | Full access to all features |

## Troubleshooting

### "relation does not exist" error

The schema hasn't been created. Run the migration first:
- Copy contents of `supabase/migrations/20260121000000_captionacc_schema.sql`
- Run in Supabase SQL Editor

### "Forbidden" when accessing /admin

Check your admin status:

```sql
SELECT * FROM captionacc.platform_admins
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your@email.com')
AND revoked_at IS NULL;
```

If empty, run the admin setup script (`supabase/scripts/setup_admin.sql`).

### Can't see videos after setup

Check your profile has correct role and approval:

```sql
SELECT role, approval_status, access_tier_id
FROM captionacc.user_profiles
WHERE id = '<your-user-uuid>';
```

Should show: `role = 'owner'`, `approval_status = 'approved'`, `access_tier_id = 'active'`

## Revoking Admin Access

To revoke admin access (don't delete, just revoke for audit trail):

```sql
UPDATE captionacc.platform_admins
SET revoked_at = NOW()
WHERE user_id = '<user-uuid>';
```

## Security Notes

- Platform admin access can only be granted via SQL (no UI for self-promotion)
- Platform admins bypass all tenant isolation via RLS policies
- Service role key (used by backend) bypasses ALL RLS
- Consider enabling MFA for platform admin accounts in production

## Related Files

- **Schema migration:** `supabase/migrations/20260121000000_captionacc_schema.sql`
- **Admin setup script:** `supabase/scripts/setup_admin.sql`
