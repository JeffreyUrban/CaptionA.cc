-- Platform Admin and Enhanced User Isolation
-- Adds platform admin infrastructure and improves tenant-level user isolation

-- ============================================================================
-- PART 1: Platform Admins Table
-- ============================================================================

-- Platform admins have cross-tenant access for system administration
CREATE TABLE platform_admins (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  admin_level TEXT NOT NULL CHECK (admin_level IN ('super_admin', 'support')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  notes TEXT
);

-- Enable RLS on platform_admins to protect the list of admins
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Only platform admins can see who else is a platform admin
CREATE POLICY "Platform admins see each other"
  ON platform_admins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM platform_admins
      WHERE user_id = auth.uid()
      AND revoked_at IS NULL
    )
  );

-- Only platform admins can grant/revoke admin access
CREATE POLICY "Platform admins manage admin grants"
  ON platform_admins FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM platform_admins
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
-- NOTE: These updates are conditional - only run if user_profiles table exists
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

-- ============================================================================
-- PART 3: Helper Functions
-- ============================================================================

-- Check if current user is an active platform admin
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM platform_admins
    WHERE user_id = auth.uid()
    AND revoked_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if current user is owner of a specific tenant
CREATE OR REPLACE FUNCTION is_tenant_owner(tenant_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM captionacc_production.user_profiles
    WHERE id = auth.uid()
    AND tenant_id = tenant_uuid
    AND role = 'owner'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Get tenant_id for current user
CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================================================
-- PART 4: Update RLS Policies - Videos Table
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Users can view tenant videos" ON captionacc_production.videos;
DROP POLICY IF EXISTS "Users can insert videos" ON captionacc_production.videos;
DROP POLICY IF EXISTS "Users can update tenant videos" ON captionacc_production.videos;

-- Members can view only their own videos
CREATE POLICY "Members view own videos"
  ON captionacc_production.videos FOR SELECT
  USING (
    uploaded_by_user_id = auth.uid()
    AND deleted_at IS NULL
  );

-- Owners can view all videos in their tenant
CREATE POLICY "Owners view tenant videos"
  ON captionacc_production.videos FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
    AND deleted_at IS NULL
  );

-- Platform admins can view all videos (for support/debugging)
CREATE POLICY "Platform admins view all videos"
  ON captionacc_production.videos FOR SELECT
  USING (is_platform_admin());

-- Any authenticated user can insert videos into their own tenant
CREATE POLICY "Users insert videos in own tenant"
  ON captionacc_production.videos FOR INSERT
  WITH CHECK (
    tenant_id = current_user_tenant_id()
    AND uploaded_by_user_id = auth.uid()
  );

-- Users can update their own videos
CREATE POLICY "Users update own videos"
  ON captionacc_production.videos FOR UPDATE
  USING (uploaded_by_user_id = auth.uid());

-- Owners can update any video in their tenant
CREATE POLICY "Owners update tenant videos"
  ON captionacc_production.videos FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can update any video
CREATE POLICY "Platform admins update all videos"
  ON captionacc_production.videos FOR UPDATE
  USING (is_platform_admin());

-- Users can soft delete their own videos
CREATE POLICY "Users soft delete own videos"
  ON captionacc_production.videos FOR DELETE
  USING (uploaded_by_user_id = auth.uid());

-- Owners can soft delete any video in their tenant
CREATE POLICY "Owners soft delete tenant videos"
  ON captionacc_production.videos FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can delete any video
CREATE POLICY "Platform admins delete all videos"
  ON captionacc_production.videos FOR DELETE
  USING (is_platform_admin());

-- ============================================================================
-- PART 5: Update RLS Policies - User Profiles Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own profile" ON captionacc_production.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON captionacc_production.user_profiles;

-- Users can view their own profile
CREATE POLICY "Users view own profile"
  ON captionacc_production.user_profiles FOR SELECT
  USING (id = auth.uid());

-- Owners can view all profiles in their tenant
CREATE POLICY "Owners view tenant profiles"
  ON captionacc_production.user_profiles FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can view all profiles
CREATE POLICY "Platform admins view all profiles"
  ON captionacc_production.user_profiles FOR SELECT
  USING (is_platform_admin());

-- Users can update their own profile (except role and tenant_id)
CREATE POLICY "Users update own profile"
  ON captionacc_production.user_profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM captionacc_production.user_profiles WHERE id = auth.uid())
    AND tenant_id = (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

-- Owners can update profiles in their tenant (including role changes)
CREATE POLICY "Owners update tenant profiles"
  ON captionacc_production.user_profiles FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can update any profile
CREATE POLICY "Platform admins update all profiles"
  ON captionacc_production.user_profiles FOR UPDATE
  USING (is_platform_admin());

-- ============================================================================
-- PART 6: Update RLS Policies - Tenants Table
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own tenant" ON captionacc_production.tenants;

-- Users can view their own tenant
CREATE POLICY "Users view own tenant"
  ON captionacc_production.tenants FOR SELECT
  USING (
    id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

-- Only owners can update tenant settings
CREATE POLICY "Owners update tenant"
  ON captionacc_production.tenants FOR UPDATE
  USING (
    id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can view and update all tenants
CREATE POLICY "Platform admins manage all tenants"
  ON captionacc_production.tenants FOR ALL
  USING (is_platform_admin());

-- ============================================================================
-- PART 7: Update RLS Policies - Search Index
-- ============================================================================

DROP POLICY IF EXISTS "Users can search tenant videos" ON captionacc_production.video_search_index;

-- Members can search only their own videos
CREATE POLICY "Members search own videos"
  ON captionacc_production.video_search_index FOR SELECT
  USING (
    video_id IN (
      SELECT id FROM captionacc_production.videos
      WHERE uploaded_by_user_id = auth.uid()
    )
  );

-- Owners can search all videos in their tenant
CREATE POLICY "Owners search tenant videos"
  ON captionacc_production.video_search_index FOR SELECT
  USING (
    video_id IN (
      SELECT id FROM captionacc_production.videos
      WHERE tenant_id IN (
        SELECT tenant_id FROM captionacc_production.user_profiles
        WHERE id = auth.uid() AND role = 'owner'
      )
    )
  );

-- Platform admins can search all videos
CREATE POLICY "Platform admins search all videos"
  ON captionacc_production.video_search_index FOR SELECT
  USING (is_platform_admin());

-- ============================================================================
-- PART 8: Audit Logging (Optional - for future use)
-- ============================================================================

-- Table for tracking platform admin actions
CREATE TABLE IF NOT EXISTS platform_admin_audit (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_tenant_id UUID REFERENCES captionacc_production.tenants(id),
  target_user_id UUID REFERENCES auth.users(id),
  target_resource_id UUID,
  resource_type TEXT, -- 'video', 'tenant', 'user', etc.
  impersonating BOOLEAN DEFAULT FALSE,
  ip_address INET,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on audit log
ALTER TABLE platform_admin_audit ENABLE ROW LEVEL SECURITY;

-- Only platform admins can view audit logs
CREATE POLICY "Platform admins view audit logs"
  ON platform_admin_audit FOR SELECT
  USING (is_platform_admin());

-- Create index for efficient audit log queries
CREATE INDEX idx_platform_admin_audit_admin ON platform_admin_audit(admin_user_id, created_at DESC);
CREATE INDEX idx_platform_admin_audit_target_tenant ON platform_admin_audit(target_tenant_id, created_at DESC);
CREATE INDEX idx_platform_admin_audit_created ON platform_admin_audit(created_at DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE platform_admins IS 'Platform administrators with cross-tenant access. Separate from tenant-level roles.';
COMMENT ON TABLE platform_admin_audit IS 'Audit log for platform admin actions. Critical for compliance and debugging.';
COMMENT ON COLUMN captionacc_production.user_profiles.role IS 'Tenant-level role: owner (tenant admin) or member (regular user). Distinct from platform admin.';
COMMENT ON FUNCTION is_platform_admin() IS 'Returns true if current user is an active platform admin (super_admin or support).';
COMMENT ON FUNCTION is_tenant_owner(UUID) IS 'Returns true if current user is an owner of the specified tenant.';
