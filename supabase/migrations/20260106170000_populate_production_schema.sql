-- Populate captionacc_production and captionacc_staging schemas
-- Recreates tables from public schema into the new schemas

-- ============================================================================
-- CAPTIONACC_PRODUCTION SCHEMA - Full setup with RLS
-- ============================================================================

-- Set search path to work in production schema
SET search_path TO captionacc_production, public;

-- Tenants table
CREATE TABLE captionacc_production.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  storage_quota_gb INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (extends auth.users)
CREATE TABLE captionacc_production.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  tenant_id UUID REFERENCES captionacc_production.tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'annotator')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Videos catalog
CREATE TABLE captionacc_production.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES captionacc_production.tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  size_bytes BIGINT,
  duration_seconds REAL,
  storage_key TEXT NOT NULL,
  captions_db_key TEXT,
  status TEXT DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'active', 'failed', 'archived', 'soft_deleted', 'purged')),
  locked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  prefect_flow_run_id UUID,
  deleted_at TIMESTAMPTZ,
  current_cropped_frames_version INTEGER
);

CREATE INDEX idx_videos_tenant ON captionacc_production.videos(tenant_id);
CREATE INDEX idx_videos_status ON captionacc_production.videos(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_locked ON captionacc_production.videos(locked_by_user_id) WHERE locked_by_user_id IS NOT NULL;

-- Training cohorts
CREATE TABLE captionacc_production.training_cohorts (
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
CREATE TABLE captionacc_production.cohort_videos (
  cohort_id TEXT REFERENCES captionacc_production.training_cohorts(id) ON DELETE CASCADE,
  video_id UUID REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES captionacc_production.tenants(id) ON DELETE CASCADE,
  frames_contributed INTEGER,
  annotations_contributed INTEGER,
  included_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cohort_id, video_id)
);

CREATE INDEX idx_cohort_videos_tenant ON captionacc_production.cohort_videos(tenant_id);

-- Search index (denormalized for cross-video search)
CREATE TABLE captionacc_production.video_search_index (
  id BIGSERIAL PRIMARY KEY,
  video_id UUID REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  frame_index INTEGER,
  ocr_text TEXT,
  caption_text TEXT,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(ocr_text, '') || ' ' || COALESCE(caption_text, ''))
  ) STORED,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_search_video ON captionacc_production.video_search_index(video_id);
CREATE INDEX idx_search_text ON captionacc_production.video_search_index USING gin(search_vector);

-- Cropped frames versions
CREATE TABLE captionacc_production.cropped_frames_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES captionacc_production.tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_prefix TEXT NOT NULL,
  layout_db_storage_key TEXT,
  layout_db_hash TEXT,
  crop_bounds JSONB,
  frame_rate REAL DEFAULT 10.0,
  chunk_count INTEGER,
  total_frames INTEGER,
  total_size_bytes BIGINT,
  status TEXT DEFAULT 'processing' CHECK (
    status IN ('processing', 'active', 'archived', 'failed')
  ),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  prefect_flow_run_id UUID,
  UNIQUE(video_id, version)
);

CREATE INDEX idx_cropped_frames_versions_video ON captionacc_production.cropped_frames_versions(video_id);
CREATE INDEX idx_cropped_frames_versions_tenant ON captionacc_production.cropped_frames_versions(tenant_id);
CREATE INDEX idx_cropped_frames_versions_status ON captionacc_production.cropped_frames_versions(status);

-- Enable RLS
ALTER TABLE captionacc_production.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_production.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_production.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_production.training_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_production.cohort_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_production.video_search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE captionacc_production.cropped_frames_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Production Schema
CREATE POLICY "Users can view own tenant"
  ON captionacc_production.tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view own profile"
  ON captionacc_production.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON captionacc_production.user_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can view tenant videos"
  ON captionacc_production.videos FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
    AND deleted_at IS NULL
  );

CREATE POLICY "Users can insert videos"
  ON captionacc_production.videos FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update tenant videos"
  ON captionacc_production.videos FOR UPDATE
  USING (
    tenant_id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Authenticated users can view cohorts"
  ON captionacc_production.training_cohorts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view cohort videos"
  ON captionacc_production.cohort_videos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can search tenant videos"
  ON captionacc_production.video_search_index FOR SELECT
  USING (
    video_id IN (
      SELECT id FROM captionacc_production.videos WHERE tenant_id IN (
        SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can view tenant video cropped frames versions"
  ON captionacc_production.cropped_frames_versions FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can create cropped frames versions"
  ON captionacc_production.cropped_frames_versions FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update cropped frames versions"
  ON captionacc_production.cropped_frames_versions FOR UPDATE
  USING (
    tenant_id IN (SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid())
  );

-- Functions (in production schema)
CREATE OR REPLACE FUNCTION captionacc_production.get_next_cropped_frames_version(p_video_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM captionacc_production.cropped_frames_versions
  WHERE video_id = p_video_id;

  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION captionacc_production.activate_cropped_frames_version(
  p_version_id UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_video_id UUID;
  v_version INTEGER;
BEGIN
  SELECT video_id, version
  INTO v_video_id, v_version
  FROM captionacc_production.cropped_frames_versions
  WHERE id = p_version_id;

  IF v_video_id IS NULL THEN
    RAISE EXCEPTION 'Version not found: %', p_version_id;
  END IF;

  UPDATE captionacc_production.cropped_frames_versions
  SET
    status = 'archived',
    archived_at = NOW()
  WHERE
    video_id = v_video_id
    AND status = 'active';

  UPDATE captionacc_production.cropped_frames_versions
  SET
    status = 'active',
    activated_at = NOW()
  WHERE id = p_version_id;

  UPDATE captionacc_production.videos
  SET current_cropped_frames_version = v_version
  WHERE id = v_video_id;
END;
$$;

-- ============================================================================
-- CAPTIONACC_STAGING SCHEMA - Same structure, no RLS (for testing)
-- ============================================================================

-- Just recreate the same tables in staging schema (structure only, no policies)
-- This allows easy schema switching for testing

SET search_path TO captionacc_staging, public;

CREATE TABLE captionacc_staging.tenants (LIKE captionacc_production.tenants INCLUDING ALL);
CREATE TABLE captionacc_staging.user_profiles (LIKE captionacc_production.user_profiles INCLUDING ALL);
CREATE TABLE captionacc_staging.videos (LIKE captionacc_production.videos INCLUDING ALL);
CREATE TABLE captionacc_staging.training_cohorts (LIKE captionacc_production.training_cohorts INCLUDING ALL);
CREATE TABLE captionacc_staging.cohort_videos (LIKE captionacc_production.cohort_videos INCLUDING ALL);
CREATE TABLE captionacc_staging.video_search_index (LIKE captionacc_production.video_search_index INCLUDING ALL);
CREATE TABLE captionacc_staging.cropped_frames_versions (LIKE captionacc_production.cropped_frames_versions INCLUDING ALL);

-- Note: LIKE INCLUDING ALL doesn't copy generated columns properly, need to recreate
ALTER TABLE captionacc_staging.video_search_index
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(ocr_text, '') || ' ' || COALESCE(caption_text, ''))
  ) STORED;

-- Recreate functions in staging schema
CREATE OR REPLACE FUNCTION captionacc_staging.get_next_cropped_frames_version(p_video_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM captionacc_staging.cropped_frames_versions
  WHERE video_id = p_video_id;

  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION captionacc_staging.activate_cropped_frames_version(
  p_version_id UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_video_id UUID;
  v_version INTEGER;
BEGIN
  SELECT video_id, version
  INTO v_video_id, v_version
  FROM captionacc_staging.cropped_frames_versions
  WHERE id = p_version_id;

  IF v_video_id IS NULL THEN
    RAISE EXCEPTION 'Version not found: %', p_version_id;
  END IF;

  UPDATE captionacc_staging.cropped_frames_versions
  SET
    status = 'archived',
    archived_at = NOW()
  WHERE
    video_id = v_video_id
    AND status = 'active';

  UPDATE captionacc_staging.cropped_frames_versions
  SET
    status = 'active',
    activated_at = NOW()
  WHERE id = p_version_id;

  UPDATE captionacc_staging.videos
  SET current_cropped_frames_version = v_version
  WHERE id = v_video_id;
END;
$$;

-- Reset search path
RESET search_path;

-- Add comments
COMMENT ON SCHEMA captionacc_production IS 'Production environment - full RLS policies active';
COMMENT ON SCHEMA captionacc_staging IS 'Staging environment - for testing, no RLS policies';
