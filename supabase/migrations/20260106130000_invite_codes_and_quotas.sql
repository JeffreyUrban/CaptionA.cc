-- Invite Codes and Resource Quotas for Preview Site Protection
-- Implements invite-only signup and strict resource limits

-- ============================================================================
-- PART 1: Invite Codes System
-- ============================================================================

CREATE TABLE invite_codes (
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
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- Only platform admins can view invite codes
CREATE POLICY "Platform admins view invite codes"
  ON invite_codes FOR SELECT
  USING (is_platform_admin());

-- Only platform admins can create invite codes
CREATE POLICY "Platform admins create invite codes"
  ON invite_codes FOR INSERT
  WITH CHECK (is_platform_admin());

-- Platform admins can update invite codes (e.g., revoke)
CREATE POLICY "Platform admins update invite codes"
  ON invite_codes FOR UPDATE
  USING (is_platform_admin());

CREATE INDEX idx_invite_codes_used_by ON invite_codes(used_by);
CREATE INDEX idx_invite_codes_created_by ON invite_codes(created_by);

COMMENT ON TABLE invite_codes IS 'Invite codes for controlled signup during preview. Only platform admins can generate.';

-- ============================================================================
-- PART 2: Update Tenant Quotas (More Restrictive for Preview)
-- ============================================================================

-- Update default storage quota to 100MB (was 100GB)
ALTER TABLE tenants
  ALTER COLUMN storage_quota_gb SET DEFAULT 0.1;  -- 100MB in GB

-- Add video count and processing limits
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS video_count_limit INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS processing_minutes_limit INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS daily_upload_limit INTEGER DEFAULT 3;

-- Update existing tenants to have preview limits
UPDATE tenants
SET storage_quota_gb = 0.1,
    video_count_limit = 5,
    processing_minutes_limit = 30,
    daily_upload_limit = 3
WHERE storage_quota_gb > 0.1 OR video_count_limit IS NULL;

COMMENT ON COLUMN tenants.storage_quota_gb IS 'Storage quota in GB. Default 0.1GB (100MB) for preview.';
COMMENT ON COLUMN tenants.video_count_limit IS 'Maximum number of active videos per tenant.';
COMMENT ON COLUMN tenants.processing_minutes_limit IS 'Maximum processing minutes per month.';
COMMENT ON COLUMN tenants.daily_upload_limit IS 'Maximum video uploads per day.';

-- ============================================================================
-- PART 3: User Approval Status
-- ============================================================================

-- Add approval status to user profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_code_used TEXT REFERENCES invite_codes(code);

-- Add constraint for approval status
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS check_approval_status;

ALTER TABLE user_profiles
  ADD CONSTRAINT check_approval_status
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- Auto-approve users who sign up with valid invite codes (handled in app logic)
-- Manual approval for others (if we allow that in future)

COMMENT ON COLUMN user_profiles.approval_status IS 'User approval state: pending, approved, rejected. Controls access to features.';
COMMENT ON COLUMN user_profiles.invite_code_used IS 'Invite code used during signup. NULL if admin-created user.';

-- ============================================================================
-- PART 4: Usage Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,  -- 'storage_gb', 'processing_minutes', 'video_count', 'uploads_today'
  metric_value NUMERIC NOT NULL,
  cost_estimate_usd NUMERIC,
  metadata JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_tenant_date ON usage_metrics(tenant_id, recorded_at DESC);
CREATE INDEX idx_usage_type_date ON usage_metrics(metric_type, recorded_at DESC);

-- Enable RLS
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

-- Owners can view their own tenant's usage
CREATE POLICY "Owners view tenant usage"
  ON usage_metrics FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can view all usage
CREATE POLICY "Platform admins view all usage"
  ON usage_metrics FOR SELECT
  USING (is_platform_admin());

COMMENT ON TABLE usage_metrics IS 'Track resource usage for quotas and cost monitoring.';

-- ============================================================================
-- PART 5: Daily Upload Tracking
-- ============================================================================

CREATE TABLE daily_uploads (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  upload_date DATE NOT NULL,
  upload_count INTEGER DEFAULT 0,
  total_bytes BIGINT DEFAULT 0,
  PRIMARY KEY (tenant_id, upload_date)
);

CREATE INDEX idx_daily_uploads_date ON daily_uploads(upload_date DESC);

-- Enable RLS
ALTER TABLE daily_uploads ENABLE ROW LEVEL SECURITY;

-- Owners can view their own tenant's upload stats
CREATE POLICY "Owners view tenant uploads"
  ON daily_uploads FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- Platform admins can view all
CREATE POLICY "Platform admins view all uploads"
  ON daily_uploads FOR SELECT
  USING (is_platform_admin());

COMMENT ON TABLE daily_uploads IS 'Track daily uploads per tenant for rate limiting.';

-- ============================================================================
-- PART 6: Update RLS Policies - Videos (Add Approval Check)
-- ============================================================================

-- Drop and recreate upload policy to include approval check
DROP POLICY IF EXISTS "Users insert videos in own tenant" ON videos;

CREATE POLICY "Approved users insert videos in own tenant"
  ON videos FOR INSERT
  WITH CHECK (
    tenant_id = current_user_tenant_id()
    AND uploaded_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND approval_status = 'approved'
    )
  );

COMMENT ON POLICY "Approved users insert videos in own tenant" ON videos IS
  'Only approved users can upload videos. Prevents unapproved signups from using resources.';

-- ============================================================================
-- PART 7: Helper Functions for Quota Checking
-- ============================================================================

-- Check if tenant can upload more videos
CREATE OR REPLACE FUNCTION can_upload_video(
  p_tenant_id UUID,
  p_video_size_bytes BIGINT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_quota_gb NUMERIC;
  v_current_usage_gb NUMERIC;
  v_video_count INTEGER;
  v_video_limit INTEGER;
  v_today_uploads INTEGER;
  v_daily_limit INTEGER;
BEGIN
  -- Get tenant quotas
  SELECT
    storage_quota_gb,
    video_count_limit,
    daily_upload_limit
  INTO v_quota_gb, v_video_limit, v_daily_limit
  FROM tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check storage quota
  SELECT COALESCE(SUM(size_bytes), 0) / 1073741824.0  -- Convert to GB
  INTO v_current_usage_gb
  FROM videos
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL;

  IF v_current_usage_gb + (p_video_size_bytes / 1073741824.0) > v_quota_gb THEN
    RETURN FALSE;  -- Storage quota exceeded
  END IF;

  -- Check video count limit
  SELECT COUNT(*)
  INTO v_video_count
  FROM videos
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL;

  IF v_video_count >= v_video_limit THEN
    RETURN FALSE;  -- Video count limit exceeded
  END IF;

  -- Check daily upload limit
  SELECT COALESCE(upload_count, 0)
  INTO v_today_uploads
  FROM daily_uploads
  WHERE tenant_id = p_tenant_id
    AND upload_date = CURRENT_DATE;

  IF v_today_uploads >= v_daily_limit THEN
    RETURN FALSE;  -- Daily upload limit exceeded
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION can_upload_video IS 'Check if tenant has quota remaining for new video upload.';

-- Get current tenant usage stats
CREATE OR REPLACE FUNCTION get_tenant_usage(p_tenant_id UUID)
RETURNS TABLE (
  storage_used_gb NUMERIC,
  storage_quota_gb NUMERIC,
  storage_percent NUMERIC,
  video_count INTEGER,
  video_limit INTEGER,
  uploads_today INTEGER,
  daily_limit INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(v.size_bytes), 0) / 1073741824.0 as storage_used_gb,
    t.storage_quota_gb,
    ROUND((COALESCE(SUM(v.size_bytes), 0) / 1073741824.0 / NULLIF(t.storage_quota_gb, 0)) * 100, 1) as storage_percent,
    COUNT(v.id)::INTEGER as video_count,
    t.video_count_limit,
    COALESCE(du.upload_count, 0)::INTEGER as uploads_today,
    t.daily_upload_limit
  FROM tenants t
  LEFT JOIN videos v ON v.tenant_id = t.id AND v.deleted_at IS NULL
  LEFT JOIN daily_uploads du ON du.tenant_id = t.id AND du.upload_date = CURRENT_DATE
  WHERE t.id = p_tenant_id
  GROUP BY t.id, t.storage_quota_gb, t.video_count_limit, t.daily_upload_limit, du.upload_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_tenant_usage IS 'Get comprehensive usage stats for a tenant.';

-- ============================================================================
-- PART 8: Create Initial Invite Codes for Platform Admins
-- ============================================================================

-- Platform admins can generate invite codes via SQL:
-- INSERT INTO invite_codes (code, created_by, max_uses, expires_at, notes)
-- VALUES (
--   'PREVIEW-' || upper(substr(md5(random()::text), 1, 8)),
--   (SELECT user_id FROM platform_admins WHERE admin_level = 'super_admin' LIMIT 1),
--   1,
--   NOW() + INTERVAL '30 days',
--   'Preview access for [person name]'
-- );
