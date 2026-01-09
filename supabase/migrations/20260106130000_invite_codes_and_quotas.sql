-- Invite Codes and Resource Quotas for Preview Site Protection
-- Implements invite-only signup and strict resource limits
--
-- NOTE: This migration works with both public and captionacc_production schemas
-- Invite codes created in public schema for cross-schema access

-- ============================================================================
-- PART 1: Invite Codes System
-- ============================================================================

CREATE TABLE IF NOT EXISTS captionacc_production.invite_codes (
  code TEXT PRIMARY KEY,
  created_by UUID REFERENCES auth.users(id),
  used_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER DEFAULT 1,
  uses_count INTEGER DEFAULT 0,
  notes TEXT,
  CONSTRAINT check_max_uses CHECK (uses_count <= max_uses)
);

-- Enable RLS
ALTER TABLE captionacc_production.invite_codes ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can SELECT invite codes for validation during signup
-- This is safe because:
-- 1. Codes are random and unpredictable
-- 2. Only valid, unexpired codes with remaining uses are useful
-- 3. The code itself is not sensitive (like a password reset token)
CREATE POLICY "Anyone can validate invite codes"
  ON captionacc_production.invite_codes FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only platform admins can create invite codes
CREATE POLICY "Platform admins create invite codes"
  ON captionacc_production.invite_codes FOR INSERT
  WITH CHECK (captionacc_production.is_platform_admin());

-- Only platform admins can update invite codes (e.g., revoke)
CREATE POLICY "Platform admins update invite codes"
  ON captionacc_production.invite_codes FOR UPDATE
  USING (captionacc_production.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON captionacc_production.invite_codes(used_by);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON captionacc_production.invite_codes(created_by);

COMMENT ON TABLE captionacc_production.invite_codes IS 'Invite codes for controlled signup during preview. Only platform admins can generate.';

-- ============================================================================
-- PART 2: Update Tenant Quotas (More Restrictive for Preview)
-- ============================================================================

-- Update tenant quotas in captionacc_production schema (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'captionacc_production'
             AND table_name = 'tenants') THEN
    ALTER TABLE captionacc_production.tenants
      ALTER COLUMN storage_quota_gb SET DEFAULT 0.1;  -- 100MB in GB

    ALTER TABLE captionacc_production.tenants
      ADD COLUMN IF NOT EXISTS video_count_limit INTEGER DEFAULT 5,
      ADD COLUMN IF NOT EXISTS processing_minutes_limit INTEGER DEFAULT 30,
      ADD COLUMN IF NOT EXISTS daily_upload_limit INTEGER DEFAULT 3;

    UPDATE captionacc_production.tenants
    SET storage_quota_gb = 0.1,
        video_count_limit = 5,
        processing_minutes_limit = 30,
        daily_upload_limit = 3
    WHERE storage_quota_gb > 0.1 OR video_count_limit IS NULL;
  END IF;
END $$;

-- Also update public schema (for backwards compatibility)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'public'
             AND table_name = 'tenants') THEN
    ALTER TABLE captionacc_production.tenants
      ALTER COLUMN storage_quota_gb SET DEFAULT 0.1;

    ALTER TABLE captionacc_production.tenants
      ADD COLUMN IF NOT EXISTS video_count_limit INTEGER DEFAULT 5,
      ADD COLUMN IF NOT EXISTS processing_minutes_limit INTEGER DEFAULT 30,
      ADD COLUMN IF NOT EXISTS daily_upload_limit INTEGER DEFAULT 3;

    UPDATE captionacc_production.tenants
    SET storage_quota_gb = 0.1,
        video_count_limit = 5,
        processing_minutes_limit = 30,
        daily_upload_limit = 3
    WHERE storage_quota_gb > 0.1 OR video_count_limit IS NULL;
  END IF;
END $$;

-- Comments will be added when tables are created in 20260106170000_populate_production_schema.sql
-- COMMENT ON COLUMN tenants.storage_quota_gb IS 'Storage quota in GB. Default 0.1GB (100MB) for preview.';
-- COMMENT ON COLUMN tenants.video_count_limit IS 'Maximum number of active videos per tenant.';
-- COMMENT ON COLUMN tenants.processing_minutes_limit IS 'Maximum processing minutes per month.';
-- COMMENT ON COLUMN tenants.daily_upload_limit IS 'Maximum video uploads per day.';

-- ============================================================================
-- PART 3: User Approval Status
-- ============================================================================

-- Add approval status to user profiles in captionacc_production schema
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'captionacc_production'
             AND table_name = 'user_profiles') THEN
    ALTER TABLE captionacc_production.user_profiles
      ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS invite_code_used TEXT REFERENCES captionacc_production.invite_codes(code);

    ALTER TABLE captionacc_production.user_profiles
      DROP CONSTRAINT IF EXISTS check_approval_status;

    ALTER TABLE captionacc_production.user_profiles
      ADD CONSTRAINT check_approval_status
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Also update public schema (for backwards compatibility)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
             WHERE table_schema = 'public'
             AND table_name = 'user_profiles') THEN
    ALTER TABLE captionacc_production.user_profiles
      ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS invite_code_used TEXT REFERENCES captionacc_production.invite_codes(code);

    ALTER TABLE captionacc_production.user_profiles
      DROP CONSTRAINT IF EXISTS check_approval_status;

    ALTER TABLE captionacc_production.user_profiles
      ADD CONSTRAINT check_approval_status
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Auto-approve users who sign up with valid invite codes (handled in app logic)
-- Manual approval for others (if we allow that in future)

-- Comments will be added when tables are created
-- COMMENT ON COLUMN user_profiles.approval_status IS 'User approval state: pending, approved, rejected. Controls access to features.';
-- COMMENT ON COLUMN user_profiles.invite_code_used IS 'Invite code used during signup. NULL if admin-created user.';

-- ============================================================================
-- PART 4: Usage Tracking
-- ============================================================================

-- NOTE: Tables and functions in Parts 4-7 are deferred to 20260106170000_populate_production_schema.sql
