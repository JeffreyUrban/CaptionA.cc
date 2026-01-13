# Platform Admin Setup - Quick Start

This guide walks you through activating the platform admin system you just implemented.

## What Was Implemented

✅ **Database Schema:**
- `platform_admins` table for cross-tenant admin access
- Updated `user_profiles.role` to use `owner` and `member` (removed `annotator`)
- Helper functions: `is_platform_admin()`, `is_tenant_owner()`, `current_user_tenant_id()`
- Audit logging table: `platform_admin_audit`

✅ **RLS Policies:**
- User isolation: members only see their own videos
- Owner access: owners see all videos in their tenant
- Platform admin bypass: admins see everything across all tenants
- Applied to: videos, user_profiles, tenants, video_search_index

✅ **Frontend Protection:**
- `/admin` route requires platform admin
- All `/api/admin/*` endpoints require platform admin
- Platform admin service with auth helpers

✅ **Documentation:**
- Comprehensive platform admin guide: `docs/PLATFORM_ADMIN.md`

## Quick Setup (5 minutes)

### Step 1: Apply the Migration

```bash
cd supabase
supabase db push
```

This applies migration `20260106120000_platform_admin_and_user_isolation.sql`

**What it does:**
- Creates platform_admins table
- Updates role names (admin→owner, user→member)
- Updates all RLS policies
- Creates helper functions

### Step 2: Grant Yourself Platform Admin Access

```bash
# Connect to your local Supabase
psql postgresql://postgres:<replace-with-db-password>@localhost:54322/postgres
```

```sql
-- Find your user ID
SELECT id, email FROM auth.users WHERE email = 'your@email.com';
-- Copy the ID

-- Grant yourself super_admin access
INSERT INTO captionacc_production.platform_admins (
  user_id,
  admin_level,
  notes
) VALUES (
  '<your-user-id>',  -- Paste your ID here
  'super_admin',
  'Initial platform admin'
);

-- Verify
SELECT
  pa.admin_level,
  pa.granted_at,
  u.email
FROM platform_admins pa
JOIN auth.users u ON pa.user_id = u.id
WHERE pa.revoked_at IS NULL;
```

### Step 3: Test Access

1. Start your dev server:
   ```bash
   cd apps/captionacc-web
   npm run dev
   ```

2. Navigate to http://localhost:5173/admin

3. You should see the admin dashboard (database management, failed videos, etc.)

4. If you get "Forbidden", double-check Step 2

### Step 4: Verify User Isolation

Test that the new isolation works:

```sql
-- Check current role values
SELECT role, COUNT(*) FROM user_profiles GROUP BY role;

-- Should see 'owner' and 'member' (not 'admin', 'user', 'annotator')

-- Test RLS: View videos as a regular user
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "<some-user-id>"}'::json;
SELECT COUNT(*) FROM videos;  -- Should only see their videos

-- Test RLS: View videos as platform admin
-- (You'll see all videos when using the UI as platform admin)
```

## What Changed

### Database Schema

**Before:**
```sql
user_profiles.role: 'admin', 'user', 'annotator'
```

**After:**
```sql
user_profiles.role: 'owner', 'member'
platform_admins.admin_level: 'super_admin', 'support'
```

**Why?**
- Clearer separation: platform roles vs tenant roles
- "owner" is more accurate than "admin" (which was confusing with platform admin)
- "member" is clearer than "user" (which is overloaded term)
- Removed "annotator" (not needed for your use case)

### Access Control

**Before:**
- All authenticated users could access /admin
- No user isolation (all tenant users saw all tenant videos)
- Single "admin" role for both platform and tenant admin

**After:**
- Only platform admins can access /admin
- Members only see their own videos, owners see all tenant videos
- Clear distinction: platform admin (cross-tenant) vs tenant owner (single tenant)

### Migration Impact

**Automatic migrations applied:**
- ✅ Existing 'admin' roles → 'owner'
- ✅ Existing 'user' roles → 'member'
- ✅ Existing 'annotator' roles → 'member'

**No breaking changes:**
- Python orchestrator code doesn't reference roles (uses service role key)
- Frontend components should continue working
- Videos remain accessible to their owners

## Troubleshooting

### "Forbidden" when accessing /admin

**Issue:** Not a platform admin

**Fix:**
```sql
-- Check if you're in platform_admins table
SELECT * FROM platform_admins
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your@email.com')
AND revoked_at IS NULL;

-- If empty, run Step 2 above
```

### Migration fails with "relation already exists"

**Issue:** Migration was partially applied

**Fix:**
```bash
# Check migration status
supabase migration list

# If migration shows as applied but tables don't exist, reset:
supabase db reset
```

### Can't see videos after migration

**Issue 1:** Role wasn't migrated correctly

**Check:**
```sql
SELECT id, role, tenant_id FROM user_profiles WHERE id = '<your-user-id>';
-- role should be 'owner' not null
```

**Fix:**
```sql
UPDATE user_profiles SET role = 'owner' WHERE id = '<your-user-id>';
```

**Issue 2:** Deleted videos filter

**Check:**
```sql
-- Videos with deleted_at are hidden by RLS
SELECT COUNT(*) FROM videos WHERE uploaded_by_user_id = '<your-user-id>';
-- vs
SELECT COUNT(*) FROM videos WHERE uploaded_by_user_id = '<your-user-id>' AND deleted_at IS NULL;
```

## Next Steps

### Immediate (Required)

1. ✅ Apply migration (Step 1)
2. ✅ Grant yourself admin access (Step 2)
3. ✅ Test /admin page access (Step 3)
4. ✅ Verify RLS policies work (Step 4)

### Soon (Recommended)

5. **Update signup flow** to auto-create tenant
   - When user signs up, create a tenant with `name = email` and `slug = user_id`
   - Set user as `owner` of new tenant
   - See `docs/PLATFORM_ADMIN.md` → "Automatic Tenant Creation"

6. **Test B2B features** (when needed)
   - Create a second user
   - Add them to your tenant
   - Set as `member` role
   - Verify they can only see their own videos

### Later (Optional)

7. **Add audit logging** to admin actions
   - Insert into `platform_admin_audit` on admin operations
   - Log: view sensitive data, modify quotas, delete videos

8. **Build tenant management UI**
   - `/admin/tenants` - list all tenants
   - `/admin/tenants/:id` - tenant details and quota management
   - See `docs/PLATFORM_ADMIN.md` → "Tenant Management UI"

9. **Implement user impersonation**
   - For debugging user issues
   - See `docs/PLATFORM_ADMIN.md` → "User Impersonation"

## Files Changed

### New Files
- `supabase/migrations/20260106120000_platform_admin_and_user_isolation.sql`
- `apps/captionacc-web/app/services/platform-admin.ts`
- `docs/PLATFORM_ADMIN.md`
- `docs/PLATFORM_ADMIN_SETUP.md` (this file)

### Modified Files
- `apps/captionacc-web/app/routes/admin.tsx`
- `apps/captionacc-web/app/routes/api.admin.failed-crop-frames.tsx`
- `apps/captionacc-web/app/routes/api.admin.databases.status.tsx`
- `apps/captionacc-web/app/routes/api.admin.databases.list.tsx`
- `apps/captionacc-web/app/routes/api.admin.databases.$videoId.schema.tsx`
- `apps/captionacc-web/app/routes/api.admin.databases.repair.tsx`
- `apps/captionacc-web/app/routes/api.admin.model-version-check.tsx`

### No Changes Required
- Python orchestrator code (uses service role, doesn't care about roles)
- Video processing flows
- Existing frontend components

## Security Notes

⚠️ **Important:**
- Platform admin access can only be granted via psql/SQL (no UI)
- There are only 3 platform admins slots in the system initially
- Platform admins bypass ALL tenant isolation
- All admin actions should be audited (TODO: implement audit logging)
- Consider enabling MFA for platform admins in production

🔒 **Service Role vs Platform Admin:**
- **Service role:** System processes (Prefect), bypasses all RLS, no audit trail
- **Platform admin:** Human operators, bypasses RLS via policies, should have audit trail

## Questions?

See comprehensive docs in `docs/PLATFORM_ADMIN.md` for:
- Complete architecture overview
- Role capabilities matrix
- Future features roadmap
- Security best practices
- Troubleshooting guide
