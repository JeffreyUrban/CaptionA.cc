-- Platform Admin and Enhanced User Isolation
-- Adds platform admin infrastructure and improves tenant-level user isolation
--
-- NOTE: This migration requires captionacc_production schema to exist

-- Ensure schema exists (in case migrations run out of order)
CREATE SCHEMA IF NOT EXISTS captionacc_production;

-- ============================================================================
-- PART 1: Platform Admins Table
-- ============================================================================

-- Platform admins have cross-tenant access for system administration
-- Created in captionacc_production schema (primary schema)
CREATE TABLE IF NOT EXISTS captionacc_production.platform_admins (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  admin_level TEXT NOT NULL CHECK (admin_level IN ('super_admin', 'support')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  notes TEXT
);

-- Enable RLS on platform_admins to protect the list of admins
ALTER TABLE captionacc_production.platform_admins ENABLE ROW LEVEL SECURITY;

-- Only platform admins can see who else is a platform admin
CREATE POLICY "Platform admins see each other"
  ON captionacc_production.platform_admins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM captionacc_production.platform_admins
      WHERE user_id = auth.uid()
      AND revoked_at IS NULL
    )
  );

-- Only platform admins can grant/revoke admin access
CREATE POLICY "Platform admins manage admin grants"
  ON captionacc_production.platform_admins FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM captionacc_production.platform_admins
      WHERE user_id = auth.uid()
      AND admin_level = 'super_admin'
      AND revoked_at IS NULL
    )
  );

-- ============================================================================
-- PART 2: Update User Roles (Tenant-level)
-- ============================================================================

-- Migrate existing roles: 'admin' → 'owner', 'user' → 'member'
-- Remove 'annotator' role (no longer needed)
-- NOTE: These updates only run if tables exist (for existing databases)

-- Try to update in captionacc_production schema first
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'captionacc_production'
             AND table_name = 'user_profiles') THEN
    UPDATE captionacc_production.user_profiles SET role = 'owner' WHERE role = 'admin';
    UPDATE captionacc_production.user_profiles SET role = 'member' WHERE role = 'user';
    UPDATE captionacc_production.user_profiles SET role = 'member' WHERE role = 'annotator';

    ALTER TABLE captionacc_production.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
    ALTER TABLE captionacc_production.user_profiles ADD CONSTRAINT user_profiles_role_check
      CHECK (role IN ('owner', 'member'));
  END IF;
END $$;

-- Also try public schema (for backwards compatibility)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'public'
             AND table_name = 'user_profiles') THEN
    UPDATE captionacc_production.user_profiles SET role = 'owner' WHERE role = 'admin';
    UPDATE captionacc_production.user_profiles SET role = 'member' WHERE role = 'user';
    UPDATE captionacc_production.user_profiles SET role = 'member' WHERE role = 'annotator';

    ALTER TABLE captionacc_production.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
    ALTER TABLE captionacc_production.user_profiles ADD CONSTRAINT user_profiles_role_check
      CHECK (role IN ('owner', 'member'));
  END IF;
END $$;

-- ============================================================================
-- PART 3: Helper Functions
-- ============================================================================

-- Check if current user is an active platform admin
CREATE OR REPLACE FUNCTION captionacc_production.is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM captionacc_production.platform_admins
    WHERE user_id = auth.uid()
    AND revoked_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if current user is owner of a specific tenant
CREATE OR REPLACE FUNCTION captionacc_production.is_tenant_owner(tenant_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_owner BOOLEAN;
BEGIN
  -- Try captionacc_production schema first
  SELECT EXISTS (
    SELECT 1 FROM captionacc_production.user_profiles
    WHERE id = auth.uid()
    AND tenant_id = tenant_uuid
    AND role = 'owner'
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN TRUE;
  END IF;

  -- Fall back to public schema
  SELECT EXISTS (
    SELECT 1 FROM captionacc_production.user_profiles
    WHERE id = auth.uid()
    AND tenant_id = tenant_uuid
    AND role = 'owner'
  ) INTO v_is_owner;

  RETURN v_is_owner;
EXCEPTION
  WHEN undefined_table THEN
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Get tenant_id for current user
CREATE OR REPLACE FUNCTION captionacc_production.current_user_tenant_id()
RETURNS UUID AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Try captionacc_production schema first
  SELECT tenant_id INTO v_tenant_id
  FROM captionacc_production.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  -- Fall back to public schema
  SELECT tenant_id INTO v_tenant_id
  FROM captionacc_production.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;

  RETURN v_tenant_id;
EXCEPTION
  WHEN undefined_table THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- PART 4: Update RLS Policies - Videos Table
-- ============================================================================
-- NOTE: These policy updates are only for existing databases.
-- For fresh databases, policies are created in 20260106170000_populate_production_schema.sql
-- --
-- -- COMMENTED OUT: Tables may not exist yet in migration order
-- -- Uncomment and run manually if migrating an existing database with data
-- 

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
-- RLS policies for user_profiles, videos, tenants, and other tables will be
-- created in migration 20260106170000_populate_production_schema.sql along
-- with the table definitions.
