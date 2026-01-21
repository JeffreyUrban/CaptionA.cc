-- ============================================================================
-- ADMIN USER SETUP SCRIPT
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER the schema migration
-- Run in BOTH prod and dev Supabase projects
--
-- Instructions:
-- 1. Run the schema migration first (migrations/20260121000000_captionacc_schema.sql)
-- 2. Replace 'your@email.com' with your actual email
-- 3. Run Step 1 to create tenant and find your user ID
-- 4. Copy your UUID from the output
-- 5. Replace 'YOUR-UUID-HERE' with your actual UUID
-- 6. Run Steps 2-4 to complete setup
-- ============================================================================

-- ============================================================================
-- STEP 1: Create tenant and find your user ID
-- ============================================================================

-- Create default tenant (required for user profiles)
INSERT INTO captionacc.tenants (name, slug)
VALUES ('Default', 'default')
ON CONFLICT (slug) DO NOTHING;

-- Find your user ID - COPY THIS UUID FOR THE NEXT STEPS
SELECT id, email FROM auth.users WHERE email = 'your@email.com';

-- ============================================================================
-- STEP 2: Create user profile (replace YOUR-UUID-HERE)
-- ============================================================================

INSERT INTO captionacc.user_profiles (
  id,
  tenant_id,
  full_name,
  role,
  approval_status,
  access_tier_id,
  created_at
)
SELECT
  'YOUR-UUID-HERE',  -- Replace with your UUID from Step 1
  (SELECT id FROM captionacc.tenants WHERE slug = 'default'),
  (SELECT COALESCE(raw_user_meta_data->>'full_name', email) FROM auth.users WHERE id = 'YOUR-UUID-HERE'),
  'owner',
  'approved',
  'active',
  NOW()
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  role = 'owner',
  approval_status = 'approved',
  access_tier_id = 'active';

-- ============================================================================
-- STEP 3: Grant platform admin (replace YOUR-UUID-HERE)
-- ============================================================================

INSERT INTO captionacc.platform_admins (user_id, admin_level, notes)
VALUES ('YOUR-UUID-HERE', 'super_admin', 'Platform owner')  -- Replace UUID
ON CONFLICT (user_id) DO UPDATE SET
  admin_level = 'super_admin',
  revoked_at = NULL;

-- ============================================================================
-- STEP 4: Verify setup (replace YOUR-UUID-HERE)
-- ============================================================================

SELECT
  u.email,
  t.name as tenant,
  t.slug as tenant_slug,
  up.role,
  up.approval_status,
  up.access_tier_id,
  pa.admin_level as platform_admin
FROM auth.users u
JOIN captionacc.user_profiles up ON up.id = u.id
JOIN captionacc.tenants t ON t.id = up.tenant_id
LEFT JOIN captionacc.platform_admins pa ON pa.user_id = u.id AND pa.revoked_at IS NULL
WHERE u.id = 'YOUR-UUID-HERE';  -- Replace UUID

-- Expected output:
-- email            | tenant  | tenant_slug | role  | approval_status | access_tier_id | platform_admin
-- your@email.com   | Default | default     | owner | approved        | active         | super_admin
