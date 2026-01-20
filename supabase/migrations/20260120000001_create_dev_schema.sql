-- Create captionacc_dev schema (clone of captionacc_prod structure)
-- This schema provides namespace isolation for development/testing
--
-- IMPORTANT: This migration is idempotent - safe to run multiple times

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS captionacc_dev;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Access tiers (must be created first for FK reference)
CREATE TABLE IF NOT EXISTS captionacc_dev.access_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  features JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenants
CREATE TABLE IF NOT EXISTS captionacc_dev.tenants (
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
CREATE TABLE IF NOT EXISTS captionacc_dev.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  tenant_id UUID REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  access_tier_id TEXT DEFAULT 'demo' REFERENCES captionacc_dev.access_tiers(id),
  access_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platform admins (cross-tenant access)
CREATE TABLE IF NOT EXISTS captionacc_dev.platform_admins (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  admin_level TEXT NOT NULL CHECK (admin_level IN ('super_admin', 'support')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  notes TEXT
);

-- Videos catalog
CREATE TABLE IF NOT EXISTS captionacc_dev.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
  video_path TEXT NOT NULL,
  display_path TEXT,
  size_bytes BIGINT,
  duration_seconds REAL,
  width INTEGER,
  height INTEGER,
  storage_key TEXT NOT NULL,
  captions_db_key TEXT,
  layout_status TEXT DEFAULT 'wait' CHECK (layout_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  boundaries_status TEXT DEFAULT 'wait' CHECK (boundaries_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  text_status TEXT DEFAULT 'wait' CHECK (text_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  total_frames INTEGER DEFAULT 0,
  covered_frames INTEGER DEFAULT 0,
  total_annotations INTEGER DEFAULT 0,
  confirmed_annotations INTEGER DEFAULT 0,
  predicted_annotations INTEGER DEFAULT 0,
  boundary_pending_count INTEGER DEFAULT 0,
  text_pending_count INTEGER DEFAULT 0,
  layout_error_details JSONB,
  boundaries_error_details JSONB,
  text_error_details JSONB,
  locked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  prefect_flow_run_id UUID,
  deleted_at TIMESTAMPTZ,
  current_cropped_frames_version INTEGER,
  is_demo BOOLEAN DEFAULT FALSE
);

-- Training cohorts
CREATE TABLE IF NOT EXISTS captionacc_dev.training_cohorts (
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
CREATE TABLE IF NOT EXISTS captionacc_dev.cohort_videos (
  cohort_id TEXT REFERENCES captionacc_dev.training_cohorts(id) ON DELETE CASCADE,
  video_id UUID REFERENCES captionacc_dev.videos(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
  frames_contributed INTEGER,
  annotations_contributed INTEGER,
  included_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cohort_id, video_id)
);

-- Cropped frames versions
CREATE TABLE IF NOT EXISTS captionacc_dev.cropped_frames_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_dev.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS captionacc_dev.invite_codes (
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'captionacc_dev' AND table_name = 'user_profiles' AND column_name = 'invite_code_used'
  ) THEN
    ALTER TABLE captionacc_dev.user_profiles
      ADD COLUMN invite_code_used TEXT REFERENCES captionacc_dev.invite_codes(code);
  END IF;
END $$;

-- Usage metrics
CREATE TABLE IF NOT EXISTS captionacc_dev.usage_metrics (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  cost_estimate_usd NUMERIC,
  metadata JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily uploads tracking
CREATE TABLE IF NOT EXISTS captionacc_dev.daily_uploads (
  tenant_id UUID REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
  upload_date DATE NOT NULL,
  upload_count INTEGER DEFAULT 0,
  total_bytes BIGINT DEFAULT 0,
  PRIMARY KEY (tenant_id, upload_date)
);

-- Caption frame extents inference runs
CREATE TABLE IF NOT EXISTS captionacc_dev.caption_frame_extents_inference_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT UNIQUE NOT NULL,
  video_id UUID NOT NULL REFERENCES captionacc_dev.videos(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS captionacc_dev.caption_frame_extents_inference_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_dev.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'low')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  inference_run_id UUID REFERENCES captionacc_dev.caption_frame_extents_inference_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Caption frame extents inference rejections
CREATE TABLE IF NOT EXISTS captionacc_dev.caption_frame_extents_inference_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_dev.videos(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS captionacc_dev.security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  user_id UUID REFERENCES auth.users(id),
  tenant_id UUID REFERENCES captionacc_dev.tenants(id),
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

-- Video database state (CR-SQLite sync)
CREATE TABLE IF NOT EXISTS captionacc_dev.video_database_state (
  video_id UUID NOT NULL REFERENCES captionacc_dev.videos(id) ON DELETE CASCADE,
  database_name TEXT NOT NULL CHECK (database_name IN ('layout', 'captions')),
  tenant_id UUID NOT NULL REFERENCES captionacc_dev.tenants(id) ON DELETE CASCADE,
  server_version BIGINT NOT NULL DEFAULT 0,
  wasabi_version BIGINT NOT NULL DEFAULT 0,
  wasabi_synced_at TIMESTAMPTZ,
  working_copy_path TEXT,
  lock_holder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lock_type TEXT CHECK (lock_type IN ('client', 'server')),
  locked_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  active_connection_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (video_id, database_name)
);

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER to bypass RLS - avoids recursion)
-- ============================================================================

CREATE OR REPLACE FUNCTION captionacc_dev.current_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM captionacc_dev.user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION captionacc_dev.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM captionacc_dev.user_profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION captionacc_dev.is_platform_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM captionacc_dev.platform_admins
    WHERE user_id = auth.uid() AND revoked_at IS NULL
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION captionacc_dev.is_current_user_owner()
RETURNS BOOLEAN AS $$
  SELECT captionacc_dev.current_user_role() = 'owner';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION captionacc_dev.is_current_user_approved()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM captionacc_dev.user_profiles
    WHERE id = auth.uid() AND approval_status = 'approved'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION captionacc_dev.get_next_cropped_frames_version(p_video_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM captionacc_dev.cropped_frames_versions WHERE video_id = p_video_id;
  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION captionacc_dev.activate_cropped_frames_version(p_version_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_video_id UUID; v_version INTEGER;
BEGIN
  SELECT video_id, version INTO v_video_id, v_version
  FROM captionacc_dev.cropped_frames_versions WHERE id = p_version_id;
  IF v_video_id IS NULL THEN RAISE EXCEPTION 'Version not found: %', p_version_id; END IF;
  UPDATE captionacc_dev.cropped_frames_versions SET status = 'archived', archived_at = NOW()
  WHERE video_id = v_video_id AND status = 'active';
  UPDATE captionacc_dev.cropped_frames_versions SET status = 'active', activated_at = NOW()
  WHERE id = p_version_id;
  UPDATE captionacc_dev.videos SET current_cropped_frames_version = v_version WHERE id = v_video_id;
END;
$$;

CREATE OR REPLACE FUNCTION captionacc_dev.has_feature_access(p_user_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_tier_id TEXT; v_features JSONB;
BEGIN
  SELECT access_tier_id INTO v_tier_id FROM captionacc_dev.user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT features INTO v_features FROM captionacc_dev.access_tiers WHERE id = v_tier_id;
  RETURN COALESCE((v_features->p_feature)::BOOLEAN, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION captionacc_dev.update_video_database_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_dev_videos_tenant ON captionacc_dev.videos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dev_videos_locked ON captionacc_dev.videos(locked_by_user_id) WHERE locked_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_videos_demo ON captionacc_dev.videos(is_demo) WHERE is_demo = TRUE;
CREATE INDEX IF NOT EXISTS idx_dev_videos_layout_status ON captionacc_dev.videos(layout_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dev_videos_boundaries_status ON captionacc_dev.videos(boundaries_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dev_videos_text_status ON captionacc_dev.videos(text_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dev_cohort_videos_tenant ON captionacc_dev.cohort_videos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dev_cropped_frames_versions_video ON captionacc_dev.cropped_frames_versions(video_id);
CREATE INDEX IF NOT EXISTS idx_dev_cropped_frames_versions_tenant ON captionacc_dev.cropped_frames_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dev_cropped_frames_versions_status ON captionacc_dev.cropped_frames_versions(status);
CREATE INDEX IF NOT EXISTS idx_dev_invite_codes_used_by ON captionacc_dev.invite_codes(used_by);
CREATE INDEX IF NOT EXISTS idx_dev_invite_codes_created_by ON captionacc_dev.invite_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_dev_usage_tenant_date ON captionacc_dev.usage_metrics(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_usage_type_date ON captionacc_dev.usage_metrics(metric_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_daily_uploads_date ON captionacc_dev.daily_uploads(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_dev_inference_runs_video ON captionacc_dev.caption_frame_extents_inference_runs(video_id);
CREATE INDEX IF NOT EXISTS idx_dev_inference_runs_tenant ON captionacc_dev.caption_frame_extents_inference_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dev_inference_jobs_video ON captionacc_dev.caption_frame_extents_inference_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_dev_inference_jobs_status ON captionacc_dev.caption_frame_extents_inference_jobs(status);
CREATE INDEX IF NOT EXISTS idx_dev_inference_rejections_video ON captionacc_dev.caption_frame_extents_inference_rejections(video_id);
CREATE INDEX IF NOT EXISTS idx_dev_inference_rejections_type ON captionacc_dev.caption_frame_extents_inference_rejections(rejection_type);
CREATE INDEX IF NOT EXISTS idx_dev_security_audit_event_type ON captionacc_dev.security_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_security_audit_severity ON captionacc_dev.security_audit_log(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_security_audit_user ON captionacc_dev.security_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_security_audit_tenant ON captionacc_dev.security_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_vds_pending_upload ON captionacc_dev.video_database_state(last_activity_at) WHERE server_version > wasabi_version;
CREATE INDEX IF NOT EXISTS idx_dev_vds_lock_holder ON captionacc_dev.video_database_state(lock_holder_user_id) WHERE lock_holder_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_vds_tenant ON captionacc_dev.video_database_state(tenant_id);

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

ALTER TABLE captionacc_dev.access_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.training_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.cohort_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.cropped_frames_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.daily_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.caption_frame_extents_inference_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.caption_frame_extents_inference_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.caption_frame_extents_inference_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.security_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_dev.video_database_state ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Drop existing policies first (idempotent)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Authenticated users view access tiers" ON captionacc_dev.access_tiers;
  DROP POLICY IF EXISTS "Platform admins manage access tiers" ON captionacc_dev.access_tiers;
  DROP POLICY IF EXISTS "Users check own admin status" ON captionacc_dev.platform_admins;
  DROP POLICY IF EXISTS "Users view own tenant" ON captionacc_dev.tenants;
  DROP POLICY IF EXISTS "Owners update own tenant" ON captionacc_dev.tenants;
  DROP POLICY IF EXISTS "Platform admins manage tenants" ON captionacc_dev.tenants;
  DROP POLICY IF EXISTS "Users view own profile" ON captionacc_dev.user_profiles;
  DROP POLICY IF EXISTS "Owners view tenant profiles" ON captionacc_dev.user_profiles;
  DROP POLICY IF EXISTS "Users update own profile" ON captionacc_dev.user_profiles;
  DROP POLICY IF EXISTS "Platform admins manage profiles" ON captionacc_dev.user_profiles;
  DROP POLICY IF EXISTS "Users view own videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Owners view tenant videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Anyone view demo videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Platform admins view all videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Approved users insert videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Users update own videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Owners update tenant videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Platform admins update videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Users delete own videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Owners delete tenant videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Platform admins delete videos" ON captionacc_dev.videos;
  DROP POLICY IF EXISTS "Authenticated view cohorts" ON captionacc_dev.training_cohorts;
  DROP POLICY IF EXISTS "Authenticated view cohort videos" ON captionacc_dev.cohort_videos;
  DROP POLICY IF EXISTS "Users view tenant cropped frames" ON captionacc_dev.cropped_frames_versions;
  DROP POLICY IF EXISTS "Users insert cropped frames" ON captionacc_dev.cropped_frames_versions;
  DROP POLICY IF EXISTS "Users update cropped frames" ON captionacc_dev.cropped_frames_versions;
  DROP POLICY IF EXISTS "Platform admins manage invite codes" ON captionacc_dev.invite_codes;
  DROP POLICY IF EXISTS "Owners view tenant usage" ON captionacc_dev.usage_metrics;
  DROP POLICY IF EXISTS "Platform admins view usage" ON captionacc_dev.usage_metrics;
  DROP POLICY IF EXISTS "Owners view tenant uploads" ON captionacc_dev.daily_uploads;
  DROP POLICY IF EXISTS "Platform admins view uploads" ON captionacc_dev.daily_uploads;
  DROP POLICY IF EXISTS "Users view tenant inference runs" ON captionacc_dev.caption_frame_extents_inference_runs;
  DROP POLICY IF EXISTS "Users view tenant inference jobs" ON captionacc_dev.caption_frame_extents_inference_jobs;
  DROP POLICY IF EXISTS "Users view tenant rejections" ON captionacc_dev.caption_frame_extents_inference_rejections;
  DROP POLICY IF EXISTS "Users update tenant rejections" ON captionacc_dev.caption_frame_extents_inference_rejections;
  DROP POLICY IF EXISTS "Platform admins view audit logs" ON captionacc_dev.security_audit_log;
  DROP POLICY IF EXISTS "Service inserts audit logs" ON captionacc_dev.security_audit_log;
  DROP POLICY IF EXISTS "Users view own tenant database state" ON captionacc_dev.video_database_state;
  DROP POLICY IF EXISTS "Platform admins view all database state" ON captionacc_dev.video_database_state;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Access tiers
CREATE POLICY "Authenticated users view access tiers"
  ON captionacc_dev.access_tiers FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Platform admins manage access tiers"
  ON captionacc_dev.access_tiers FOR ALL
  USING (captionacc_dev.is_platform_admin());

-- Platform admins
CREATE POLICY "Users check own admin status"
  ON captionacc_dev.platform_admins FOR SELECT
  USING (user_id = auth.uid());

-- Tenants
CREATE POLICY "Users view own tenant"
  ON captionacc_dev.tenants FOR SELECT
  USING (id = captionacc_dev.current_user_tenant_id());

CREATE POLICY "Owners update own tenant"
  ON captionacc_dev.tenants FOR UPDATE
  USING (id = captionacc_dev.current_user_tenant_id() AND captionacc_dev.is_current_user_owner());

CREATE POLICY "Platform admins manage tenants"
  ON captionacc_dev.tenants FOR ALL
  USING (captionacc_dev.is_platform_admin());

-- User profiles
CREATE POLICY "Users view own profile"
  ON captionacc_dev.user_profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Owners view tenant profiles"
  ON captionacc_dev.user_profiles FOR SELECT
  USING (
    captionacc_dev.is_current_user_owner()
    AND tenant_id = captionacc_dev.current_user_tenant_id()
  );

CREATE POLICY "Users update own profile"
  ON captionacc_dev.user_profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Platform admins manage profiles"
  ON captionacc_dev.user_profiles FOR ALL
  USING (captionacc_dev.is_platform_admin());

-- Videos
CREATE POLICY "Users view own videos"
  ON captionacc_dev.videos FOR SELECT
  USING (uploaded_by_user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Owners view tenant videos"
  ON captionacc_dev.videos FOR SELECT
  USING (
    captionacc_dev.is_current_user_owner()
    AND tenant_id = captionacc_dev.current_user_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "Anyone view demo videos"
  ON captionacc_dev.videos FOR SELECT
  USING (is_demo = TRUE AND deleted_at IS NULL);

CREATE POLICY "Platform admins view all videos"
  ON captionacc_dev.videos FOR SELECT
  USING (captionacc_dev.is_platform_admin());

CREATE POLICY "Approved users insert videos"
  ON captionacc_dev.videos FOR INSERT
  WITH CHECK (
    tenant_id = captionacc_dev.current_user_tenant_id()
    AND uploaded_by_user_id = auth.uid()
    AND captionacc_dev.is_current_user_approved()
  );

CREATE POLICY "Users update own videos"
  ON captionacc_dev.videos FOR UPDATE
  USING (uploaded_by_user_id = auth.uid());

CREATE POLICY "Owners update tenant videos"
  ON captionacc_dev.videos FOR UPDATE
  USING (
    captionacc_dev.is_current_user_owner()
    AND tenant_id = captionacc_dev.current_user_tenant_id()
  );

CREATE POLICY "Platform admins update videos"
  ON captionacc_dev.videos FOR UPDATE
  USING (captionacc_dev.is_platform_admin());

CREATE POLICY "Users delete own videos"
  ON captionacc_dev.videos FOR DELETE
  USING (uploaded_by_user_id = auth.uid());

CREATE POLICY "Owners delete tenant videos"
  ON captionacc_dev.videos FOR DELETE
  USING (
    captionacc_dev.is_current_user_owner()
    AND tenant_id = captionacc_dev.current_user_tenant_id()
  );

CREATE POLICY "Platform admins delete videos"
  ON captionacc_dev.videos FOR DELETE
  USING (captionacc_dev.is_platform_admin());

-- Training cohorts
CREATE POLICY "Authenticated view cohorts"
  ON captionacc_dev.training_cohorts FOR SELECT
  TO authenticated USING (true);

-- Cohort videos
CREATE POLICY "Authenticated view cohort videos"
  ON captionacc_dev.cohort_videos FOR SELECT
  TO authenticated USING (true);

-- Cropped frames versions
CREATE POLICY "Users view tenant cropped frames"
  ON captionacc_dev.cropped_frames_versions FOR SELECT
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

CREATE POLICY "Users insert cropped frames"
  ON captionacc_dev.cropped_frames_versions FOR INSERT
  WITH CHECK (tenant_id = captionacc_dev.current_user_tenant_id());

CREATE POLICY "Users update cropped frames"
  ON captionacc_dev.cropped_frames_versions FOR UPDATE
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

-- Invite codes
CREATE POLICY "Platform admins manage invite codes"
  ON captionacc_dev.invite_codes FOR ALL
  USING (captionacc_dev.is_platform_admin());

-- Usage metrics
CREATE POLICY "Owners view tenant usage"
  ON captionacc_dev.usage_metrics FOR SELECT
  USING (
    captionacc_dev.is_current_user_owner()
    AND tenant_id = captionacc_dev.current_user_tenant_id()
  );

CREATE POLICY "Platform admins view usage"
  ON captionacc_dev.usage_metrics FOR SELECT
  USING (captionacc_dev.is_platform_admin());

-- Daily uploads
CREATE POLICY "Owners view tenant uploads"
  ON captionacc_dev.daily_uploads FOR SELECT
  USING (
    captionacc_dev.is_current_user_owner()
    AND tenant_id = captionacc_dev.current_user_tenant_id()
  );

CREATE POLICY "Platform admins view uploads"
  ON captionacc_dev.daily_uploads FOR SELECT
  USING (captionacc_dev.is_platform_admin());

-- Caption frame extents inference runs
CREATE POLICY "Users view tenant inference runs"
  ON captionacc_dev.caption_frame_extents_inference_runs FOR SELECT
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

-- Caption frame extents inference jobs
CREATE POLICY "Users view tenant inference jobs"
  ON captionacc_dev.caption_frame_extents_inference_jobs FOR SELECT
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

-- Caption frame extents inference rejections
CREATE POLICY "Users view tenant rejections"
  ON captionacc_dev.caption_frame_extents_inference_rejections FOR SELECT
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

CREATE POLICY "Users update tenant rejections"
  ON captionacc_dev.caption_frame_extents_inference_rejections FOR UPDATE
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

-- Security audit log
CREATE POLICY "Platform admins view audit logs"
  ON captionacc_dev.security_audit_log FOR SELECT
  USING (captionacc_dev.is_platform_admin());

CREATE POLICY "Service inserts audit logs"
  ON captionacc_dev.security_audit_log FOR INSERT
  WITH CHECK (true);

-- Video database state
CREATE POLICY "Users view own tenant database state"
  ON captionacc_dev.video_database_state FOR SELECT
  USING (tenant_id = captionacc_dev.current_user_tenant_id());

CREATE POLICY "Platform admins view all database state"
  ON captionacc_dev.video_database_state FOR SELECT
  USING (captionacc_dev.is_platform_admin());

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS video_database_state_updated_at ON captionacc_dev.video_database_state;
CREATE TRIGGER video_database_state_updated_at
  BEFORE UPDATE ON captionacc_dev.video_database_state
  FOR EACH ROW
  EXECUTE FUNCTION captionacc_dev.update_video_database_state_updated_at();

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO captionacc_dev.access_tiers (id, name, description, features) VALUES
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
