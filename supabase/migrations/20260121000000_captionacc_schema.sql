-- CaptionA.cc Schema Setup
-- Use this for both prod and dev Supabase projects
-- The schema name is 'captionacc' in both environments
--
-- Run this in Supabase SQL Editor for each project (prod and dev)

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS captionacc;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Access tiers (must be created first for FK reference)
CREATE TABLE captionacc.access_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  features JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenants
CREATE TABLE captionacc.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  storage_quota_gb NUMERIC DEFAULT 0.1,
  video_count_limit INTEGER DEFAULT 5,
  processing_minutes_limit INTEGER DEFAULT 30,
  daily_upload_limit INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (extends auth.users)
CREATE TABLE captionacc.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  tenant_id UUID REFERENCES captionacc.tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  access_tier_id TEXT DEFAULT 'demo' REFERENCES captionacc.access_tiers(id),
  access_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platform admins (cross-tenant access)
CREATE TABLE captionacc.platform_admins (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  admin_level TEXT NOT NULL CHECK (admin_level IN ('super_admin', 'support')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  notes TEXT
);

-- Videos catalog
CREATE TABLE captionacc.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES captionacc.tenants(id) ON DELETE CASCADE,

  -- File info
  video_path TEXT NOT NULL,
  display_path TEXT,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT,
  duration_seconds REAL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,

  -- Database references
  captions_db_key TEXT,

  -- Workflow status (user action states)
  layout_status TEXT DEFAULT 'wait' CHECK (layout_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  boundaries_status TEXT DEFAULT 'wait' CHECK (boundaries_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  text_status TEXT DEFAULT 'wait' CHECK (text_status IN ('wait', 'annotate', 'done', 'review', 'error')),

  -- Stats (updated by Prefect flows and API)
  total_frames INTEGER DEFAULT 0,
  covered_frames INTEGER DEFAULT 0,
  total_annotations INTEGER DEFAULT 0,
  confirmed_annotations INTEGER DEFAULT 0,
  predicted_annotations INTEGER DEFAULT 0,
  boundary_pending_count INTEGER DEFAULT 0,
  text_pending_count INTEGER DEFAULT 0,

  -- Error tracking
  layout_error_details JSONB,
  boundaries_error_details JSONB,
  text_error_details JSONB,

  -- Locking (legacy, prefer video_database_state)
  locked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,

  -- Ownership
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),

  -- Processing
  prefect_flow_run_id UUID,
  current_cropped_frames_version INTEGER,

  -- Soft delete
  deleted_at TIMESTAMPTZ,

  -- Demo flag
  is_demo BOOLEAN DEFAULT FALSE
);

COMMENT ON COLUMN captionacc.videos.display_path IS 'Display path for organizing videos in folders (e.g., "level1/video_name")';
COMMENT ON COLUMN captionacc.videos.width IS 'Video width in pixels (0 if unknown)';
COMMENT ON COLUMN captionacc.videos.height IS 'Video height in pixels (0 if unknown)';
COMMENT ON COLUMN captionacc.videos.layout_status IS 'User action state: wait (processing), annotate (ready), done (approved), review (needs review), error';
COMMENT ON COLUMN captionacc.videos.boundaries_status IS 'User action state: wait (needs layout), annotate (ready), done (complete), review (needs review), error';
COMMENT ON COLUMN captionacc.videos.text_status IS 'User action state: wait (needs boundaries), annotate (ready), done (complete), review (needs review), error';

-- Video database state (CR-SQLite sync)
CREATE TABLE captionacc.video_database_state (
  -- Composite primary key
  video_id UUID NOT NULL REFERENCES captionacc.videos(id) ON DELETE CASCADE,
  database_name TEXT NOT NULL CHECK (database_name IN ('layout', 'captions')),
  tenant_id UUID NOT NULL REFERENCES captionacc.tenants(id) ON DELETE CASCADE,

  -- Versioning
  server_version BIGINT NOT NULL DEFAULT 0,      -- Increments on every change (authoritative)
  wasabi_version BIGINT NOT NULL DEFAULT 0,      -- Version currently in Wasabi (cold storage)
  wasabi_synced_at TIMESTAMPTZ,                  -- When Wasabi was last updated

  -- Working Copy
  working_copy_path TEXT,                        -- Local filesystem path on server

  -- Lock (user-level, not session-level)
  lock_holder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lock_type TEXT CHECK (lock_type IN ('client', 'server')),
  locked_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,                  -- Last change (for idle timeout)

  -- Active Connection (for routing only, not locking)
  active_connection_id TEXT,                     -- WebSocket connection ID

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (video_id, database_name)
);

-- Training cohorts
CREATE TABLE captionacc.training_cohorts (
  id TEXT PRIMARY KEY,
  language TEXT,
  domain TEXT,
  snapshot_storage_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  wandb_run_id TEXT,
  git_commit TEXT,
  total_videos INTEGER,
  total_frames INTEGER,
  total_annotations INTEGER,
  status TEXT DEFAULT 'building' CHECK (status IN ('building', 'training', 'completed', 'deprecated')),
  immutable BOOLEAN DEFAULT FALSE
);

-- Cohort videos (many-to-many)
CREATE TABLE captionacc.cohort_videos (
  cohort_id TEXT REFERENCES captionacc.training_cohorts(id) ON DELETE CASCADE,
  video_id UUID REFERENCES captionacc.videos(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES captionacc.tenants(id) ON DELETE CASCADE,
  frames_contributed INTEGER,
  annotations_contributed INTEGER,
  included_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cohort_id, video_id)
);

-- Cropped frames versions
CREATE TABLE captionacc.cropped_frames_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES captionacc.tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_prefix TEXT NOT NULL,
  layout_db_storage_key TEXT,
  layout_db_hash TEXT,
  crop_region JSONB,
  frame_rate REAL DEFAULT 10.0,
  chunk_count INTEGER,
  total_frames INTEGER,
  total_size_bytes BIGINT,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'active', 'archived', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  prefect_flow_run_id UUID,
  UNIQUE(video_id, version)
);

-- Invite codes
CREATE TABLE captionacc.invite_codes (
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

-- Add FK for invite_code_used after invite_codes table exists
ALTER TABLE captionacc.user_profiles
  ADD COLUMN invite_code_used TEXT REFERENCES captionacc.invite_codes(code);

-- Usage metrics
CREATE TABLE captionacc.usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES captionacc.tenants(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  cost_estimate_usd NUMERIC,
  metadata JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily uploads tracking
CREATE TABLE captionacc.daily_uploads (
  tenant_id UUID REFERENCES captionacc.tenants(id) ON DELETE CASCADE,
  upload_date DATE NOT NULL,
  upload_count INTEGER DEFAULT 0,
  total_bytes BIGINT DEFAULT 0,
  PRIMARY KEY (tenant_id, upload_date)
);

-- Caption frame extents inference runs
CREATE TABLE captionacc.caption_frame_extents_inference_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT UNIQUE NOT NULL,
  video_id UUID NOT NULL REFERENCES captionacc.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  model_checkpoint_path TEXT,
  wasabi_storage_key TEXT NOT NULL,
  file_size_bytes BIGINT,
  total_pairs INTEGER NOT NULL,
  processing_time_seconds REAL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(video_id, cropped_frames_version, model_version)
);

-- Caption frame extents inference jobs
CREATE TABLE captionacc.caption_frame_extents_inference_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'low')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  inference_run_id UUID REFERENCES captionacc.caption_frame_extents_inference_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Caption frame extents inference rejections
CREATE TABLE captionacc.caption_frame_extents_inference_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  rejection_type TEXT NOT NULL CHECK (rejection_type IN (
    'frame_count_exceeded', 'cost_exceeded', 'validation_failed', 'rate_limited', 'queue_full'
  )),
  rejection_message TEXT NOT NULL,
  frame_count INTEGER,
  estimated_cost_usd REAL,
  cropped_frames_version INTEGER,
  model_version TEXT,
  priority TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id)
);

-- Security audit log
CREATE TABLE captionacc.security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  user_id UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES captionacc.tenants(id),
  resource_type TEXT,
  resource_id TEXT,
  target_tenant_id UUID,
  ip_address INET,
  user_agent TEXT,
  request_path TEXT,
  request_method TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER to bypass RLS - avoids recursion)
-- ============================================================================

-- Get current user's tenant_id
CREATE OR REPLACE FUNCTION captionacc.current_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM captionacc.user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Get current user's role
CREATE OR REPLACE FUNCTION captionacc.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM captionacc.user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if current user is an active platform admin
CREATE OR REPLACE FUNCTION captionacc.is_platform_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM captionacc.platform_admins
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if current user is owner (uses security definer, no recursion)
CREATE OR REPLACE FUNCTION captionacc.is_current_user_owner()
RETURNS BOOLEAN AS $$
  SELECT captionacc.current_user_role() = 'owner';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if current user is approved
CREATE OR REPLACE FUNCTION captionacc.is_current_user_approved()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM captionacc.user_profiles
    WHERE id = auth.uid() AND approval_status = 'approved'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Videos
CREATE INDEX idx_videos_tenant ON captionacc.videos(tenant_id);
CREATE INDEX idx_videos_locked ON captionacc.videos(locked_by_user_id) WHERE locked_by_user_id IS NOT NULL;
CREATE INDEX idx_videos_demo ON captionacc.videos(is_demo) WHERE is_demo = TRUE;
CREATE INDEX idx_videos_layout_status ON captionacc.videos(layout_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_boundaries_status ON captionacc.videos(boundaries_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_text_status ON captionacc.videos(text_status) WHERE deleted_at IS NULL;

-- Video database state
CREATE INDEX idx_vds_pending_upload ON captionacc.video_database_state(last_activity_at)
    WHERE server_version > wasabi_version;
CREATE INDEX idx_vds_lock_holder ON captionacc.video_database_state(lock_holder_user_id)
    WHERE lock_holder_user_id IS NOT NULL;
CREATE INDEX idx_vds_tenant ON captionacc.video_database_state(tenant_id);

-- Other tables
CREATE INDEX idx_cohort_videos_tenant ON captionacc.cohort_videos(tenant_id);
CREATE INDEX idx_cropped_frames_versions_video ON captionacc.cropped_frames_versions(video_id);
CREATE INDEX idx_cropped_frames_versions_tenant ON captionacc.cropped_frames_versions(tenant_id);
CREATE INDEX idx_cropped_frames_versions_status ON captionacc.cropped_frames_versions(status);
CREATE INDEX idx_invite_codes_used_by ON captionacc.invite_codes(used_by);
CREATE INDEX idx_invite_codes_created_by ON captionacc.invite_codes(created_by);
CREATE INDEX idx_usage_tenant_date ON captionacc.usage_metrics(tenant_id, recorded_at DESC);
CREATE INDEX idx_usage_type_date ON captionacc.usage_metrics(metric_type, recorded_at DESC);
CREATE INDEX idx_daily_uploads_date ON captionacc.daily_uploads(upload_date DESC);
CREATE INDEX idx_inference_runs_video ON captionacc.caption_frame_extents_inference_runs(video_id);
CREATE INDEX idx_inference_runs_tenant ON captionacc.caption_frame_extents_inference_runs(tenant_id);
CREATE INDEX idx_inference_jobs_video ON captionacc.caption_frame_extents_inference_jobs(video_id);
CREATE INDEX idx_inference_jobs_status ON captionacc.caption_frame_extents_inference_jobs(status);
CREATE INDEX idx_inference_rejections_video ON captionacc.caption_frame_extents_inference_rejections(video_id);
CREATE INDEX idx_inference_rejections_type ON captionacc.caption_frame_extents_inference_rejections(rejection_type);
CREATE INDEX idx_security_audit_event_type ON captionacc.security_audit_log(event_type, created_at DESC);
CREATE INDEX idx_security_audit_severity ON captionacc.security_audit_log(severity, created_at DESC);
CREATE INDEX idx_security_audit_user ON captionacc.security_audit_log(user_id, created_at DESC);
CREATE INDEX idx_security_audit_tenant ON captionacc.security_audit_log(tenant_id, created_at DESC);

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

ALTER TABLE captionacc.access_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.video_database_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.training_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.cohort_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.cropped_frames_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.daily_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.caption_frame_extents_inference_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.caption_frame_extents_inference_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.caption_frame_extents_inference_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc.security_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES (using SECURITY DEFINER functions to avoid recursion)
-- ============================================================================

-- Access tiers: authenticated users can read
CREATE POLICY "Authenticated users view access tiers"
  ON captionacc.access_tiers FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Platform admins manage access tiers"
  ON captionacc.access_tiers FOR ALL
  USING (captionacc.is_platform_admin());

-- Platform admins: simple self-check (no recursion)
CREATE POLICY "Users check own admin status"
  ON captionacc.platform_admins FOR SELECT
  USING (user_id = auth.uid());

-- Tenants
CREATE POLICY "Users view own tenant"
  ON captionacc.tenants FOR SELECT
  USING (id = captionacc.current_user_tenant_id());

CREATE POLICY "Owners update own tenant"
  ON captionacc.tenants FOR UPDATE
  USING (id = captionacc.current_user_tenant_id() AND captionacc.is_current_user_owner());

CREATE POLICY "Platform admins manage tenants"
  ON captionacc.tenants FOR ALL
  USING (captionacc.is_platform_admin());

-- User profiles (no subqueries on user_profiles - use functions)
CREATE POLICY "Users view own profile"
  ON captionacc.user_profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Owners view tenant profiles"
  ON captionacc.user_profiles FOR SELECT
  USING (
    captionacc.is_current_user_owner()
    AND tenant_id = captionacc.current_user_tenant_id()
  );

CREATE POLICY "Users update own profile"
  ON captionacc.user_profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Platform admins manage profiles"
  ON captionacc.user_profiles FOR ALL
  USING (captionacc.is_platform_admin());

-- Videos
CREATE POLICY "Users view own videos"
  ON captionacc.videos FOR SELECT
  USING (uploaded_by_user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Owners view tenant videos"
  ON captionacc.videos FOR SELECT
  USING (
    captionacc.is_current_user_owner()
    AND tenant_id = captionacc.current_user_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "Anyone view demo videos"
  ON captionacc.videos FOR SELECT
  USING (is_demo = TRUE AND deleted_at IS NULL);

CREATE POLICY "Platform admins view all videos"
  ON captionacc.videos FOR SELECT
  USING (captionacc.is_platform_admin());

CREATE POLICY "Approved users insert videos"
  ON captionacc.videos FOR INSERT
  WITH CHECK (
    tenant_id = captionacc.current_user_tenant_id()
    AND uploaded_by_user_id = auth.uid()
    AND captionacc.is_current_user_approved()
  );

CREATE POLICY "Users update own videos"
  ON captionacc.videos FOR UPDATE
  USING (uploaded_by_user_id = auth.uid());

CREATE POLICY "Owners update tenant videos"
  ON captionacc.videos FOR UPDATE
  USING (
    captionacc.is_current_user_owner()
    AND tenant_id = captionacc.current_user_tenant_id()
  );

CREATE POLICY "Platform admins update videos"
  ON captionacc.videos FOR UPDATE
  USING (captionacc.is_platform_admin());

CREATE POLICY "Users delete own videos"
  ON captionacc.videos FOR DELETE
  USING (uploaded_by_user_id = auth.uid());

CREATE POLICY "Owners delete tenant videos"
  ON captionacc.videos FOR DELETE
  USING (
    captionacc.is_current_user_owner()
    AND tenant_id = captionacc.current_user_tenant_id()
  );

CREATE POLICY "Platform admins delete videos"
  ON captionacc.videos FOR DELETE
  USING (captionacc.is_platform_admin());

-- Video database state
CREATE POLICY "Users view own tenant database state"
  ON captionacc.video_database_state FOR SELECT
  USING (tenant_id = captionacc.current_user_tenant_id());

CREATE POLICY "Platform admins view all database state"
  ON captionacc.video_database_state FOR SELECT
  USING (captionacc.is_platform_admin());

-- Training cohorts
CREATE POLICY "Authenticated view cohorts"
  ON captionacc.training_cohorts FOR SELECT
  TO authenticated USING (true);

-- Cohort videos
CREATE POLICY "Authenticated view cohort videos"
  ON captionacc.cohort_videos FOR SELECT
  TO authenticated USING (true);

-- Cropped frames versions
CREATE POLICY "Users view tenant cropped frames"
  ON captionacc.cropped_frames_versions FOR SELECT
  USING (tenant_id = captionacc.current_user_tenant_id());

CREATE POLICY "Users insert cropped frames"
  ON captionacc.cropped_frames_versions FOR INSERT
  WITH CHECK (tenant_id = captionacc.current_user_tenant_id());

CREATE POLICY "Users update cropped frames"
  ON captionacc.cropped_frames_versions FOR UPDATE
  USING (tenant_id = captionacc.current_user_tenant_id());

-- Invite codes
CREATE POLICY "Platform admins manage invite codes"
  ON captionacc.invite_codes FOR ALL
  USING (captionacc.is_platform_admin());

-- Usage metrics
CREATE POLICY "Owners view tenant usage"
  ON captionacc.usage_metrics FOR SELECT
  USING (
    captionacc.is_current_user_owner()
    AND tenant_id = captionacc.current_user_tenant_id()
  );

CREATE POLICY "Platform admins view usage"
  ON captionacc.usage_metrics FOR SELECT
  USING (captionacc.is_platform_admin());

-- Daily uploads
CREATE POLICY "Owners view tenant uploads"
  ON captionacc.daily_uploads FOR SELECT
  USING (
    captionacc.is_current_user_owner()
    AND tenant_id = captionacc.current_user_tenant_id()
  );

CREATE POLICY "Platform admins view uploads"
  ON captionacc.daily_uploads FOR SELECT
  USING (captionacc.is_platform_admin());

-- Caption frame extents inference runs
CREATE POLICY "Users view tenant inference runs"
  ON captionacc.caption_frame_extents_inference_runs FOR SELECT
  USING (tenant_id = captionacc.current_user_tenant_id());

-- Caption frame extents inference jobs
CREATE POLICY "Users view tenant inference jobs"
  ON captionacc.caption_frame_extents_inference_jobs FOR SELECT
  USING (tenant_id = captionacc.current_user_tenant_id());

-- Caption frame extents inference rejections
CREATE POLICY "Users view tenant rejections"
  ON captionacc.caption_frame_extents_inference_rejections FOR SELECT
  USING (tenant_id = captionacc.current_user_tenant_id());

CREATE POLICY "Users update tenant rejections"
  ON captionacc.caption_frame_extents_inference_rejections FOR UPDATE
  USING (tenant_id = captionacc.current_user_tenant_id());

-- Security audit log
CREATE POLICY "Platform admins view audit logs"
  ON captionacc.security_audit_log FOR SELECT
  USING (captionacc.is_platform_admin());

CREATE POLICY "Service inserts audit logs"
  ON captionacc.security_audit_log FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update video_database_state.updated_at on change
CREATE OR REPLACE FUNCTION captionacc.update_video_database_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_database_state_updated_at
  BEFORE UPDATE ON captionacc.video_database_state
  FOR EACH ROW
  EXECUTE FUNCTION captionacc.update_video_database_state_updated_at();

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION captionacc.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Get first available tenant
  SELECT id INTO v_tenant_id
  FROM captionacc.tenants
  LIMIT 1;

  -- Create user profile if tenant exists
  IF v_tenant_id IS NOT NULL THEN
    INSERT INTO captionacc.user_profiles (
      id,
      tenant_id,
      full_name,
      role,
      approval_status,
      access_tier_id,
      created_at
    )
    VALUES (
      NEW.id,
      v_tenant_id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      'member',
      'approved',
      'demo',
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on auth.users (if not exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION captionacc.handle_new_user();

-- ============================================================================
-- ADDITIONAL FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION captionacc.get_next_cropped_frames_version(p_video_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM captionacc.cropped_frames_versions WHERE video_id = p_video_id;
  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION captionacc.activate_cropped_frames_version(p_version_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_video_id UUID; v_version INTEGER;
BEGIN
  SELECT video_id, version INTO v_video_id, v_version
  FROM captionacc.cropped_frames_versions WHERE id = p_version_id;
  IF v_video_id IS NULL THEN RAISE EXCEPTION 'Version not found: %', p_version_id; END IF;
  UPDATE captionacc.cropped_frames_versions SET status = 'archived', archived_at = NOW()
  WHERE video_id = v_video_id AND status = 'active';
  UPDATE captionacc.cropped_frames_versions SET status = 'active', activated_at = NOW()
  WHERE id = p_version_id;
  UPDATE captionacc.videos SET current_cropped_frames_version = v_version WHERE id = v_video_id;
END;
$$;

CREATE OR REPLACE FUNCTION captionacc.has_feature_access(p_user_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_tier_id TEXT; v_features JSONB;
BEGIN
  SELECT access_tier_id INTO v_tier_id FROM captionacc.user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT features INTO v_features FROM captionacc.access_tiers WHERE id = v_tier_id;
  RETURN COALESCE((v_features->p_feature)::BOOLEAN, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO captionacc.access_tiers (id, name, description, features) VALUES
  ('demo', 'Demo Access', 'Read-only access to demo videos only',
   '{"max_videos": 0, "max_storage_gb": 0, "annotation": false, "export": false, "upload": false, "demo_access": true}'),
  ('trial', 'Trial Access', 'Upload up to 3 videos with annotation access',
   '{"max_videos": 3, "max_storage_gb": 1, "annotation": true, "annotation_video_limit": 3, "export": true, "upload": true, "demo_access": true}'),
  ('active', 'Active Access', 'Full access to all features',
   '{"max_videos": 1000, "max_storage_gb": 100, "annotation": true, "export": true, "upload": true, "demo_access": true}')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- NOTIFY POSTGREST
-- ============================================================================

NOTIFY pgrst, 'reload schema';
