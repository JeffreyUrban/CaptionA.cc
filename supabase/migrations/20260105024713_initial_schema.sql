-- Initial schema for CaptionA.cc
-- Multi-tenant video annotation system with Prefect integration

-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  storage_quota_gb INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (extends auth.users)
CREATE TABLE user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'annotator')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Videos catalog
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- File metadata
  filename TEXT NOT NULL,
  size_bytes BIGINT,
  duration_seconds REAL,

  -- Storage (Wasabi)
  storage_key TEXT NOT NULL,  -- wasabi://videos/{tenant_id}/{video_id}/video.mp4
  annotations_db_key TEXT,     -- wasabi://videos/{tenant_id}/{video_id}/annotations.db

  -- Status
  status TEXT DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'active', 'failed', 'archived', 'soft_deleted', 'purged')),

  -- Workspace/locking
  locked_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,

  -- Metadata
  uploaded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prefect integration
  prefect_flow_run_id UUID,

  -- Lifecycle
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_videos_tenant ON videos(tenant_id);
CREATE INDEX idx_videos_status ON videos(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_locked ON videos(locked_by_user_id) WHERE locked_by_user_id IS NOT NULL;

-- Training cohorts
CREATE TABLE training_cohorts (
  id TEXT PRIMARY KEY,  -- e.g., 'cohort_zh-Hans_v1.2'
  language TEXT,
  domain TEXT,

  -- Snapshot metadata
  snapshot_storage_key TEXT,  -- wasabi://training-snapshots/{id}/
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Training info
  wandb_run_id TEXT,
  git_commit TEXT,

  -- Stats
  total_videos INTEGER,
  total_frames INTEGER,
  total_annotations INTEGER,

  -- Status
  status TEXT DEFAULT 'building' CHECK (status IN ('building', 'training', 'completed', 'deprecated')),
  immutable BOOLEAN DEFAULT FALSE
);

-- Cohort videos (many-to-many)
CREATE TABLE cohort_videos (
  cohort_id TEXT REFERENCES training_cohorts(id) ON DELETE CASCADE,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

  frames_contributed INTEGER,
  annotations_contributed INTEGER,
  included_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (cohort_id, video_id)
);

CREATE INDEX idx_cohort_videos_tenant ON cohort_videos(tenant_id);

-- Search index (denormalized for cross-video search)
CREATE TABLE video_search_index (
  id BIGSERIAL PRIMARY KEY,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  frame_index INTEGER,
  ocr_text TEXT,
  caption_text TEXT,

  -- Full-text search
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(ocr_text, '') || ' ' || COALESCE(caption_text, ''))
  ) STORED,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_search_video ON video_search_index(video_id);
CREATE INDEX idx_search_text ON video_search_index USING gin(search_vector);

-- Enable Row Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_search_index ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Tenants: Users can only see their own tenant
CREATE POLICY "Users can view own tenant"
  ON tenants FOR SELECT
  USING (id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- User profiles: Users can view/update their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Videos: Users can only see videos from their tenant
CREATE POLICY "Users can view tenant videos"
  ON videos FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    AND deleted_at IS NULL
  );

CREATE POLICY "Users can insert videos"
  ON videos FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can update tenant videos"
  ON videos FOR UPDATE
  USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- Training cohorts: Read-only for all authenticated users
CREATE POLICY "Authenticated users can view cohorts"
  ON training_cohorts FOR SELECT
  TO authenticated
  USING (true);

-- Cohort videos: Read-only for all authenticated users
CREATE POLICY "Authenticated users can view cohort videos"
  ON cohort_videos FOR SELECT
  TO authenticated
  USING (true);

-- Search index: Inherits from videos table
CREATE POLICY "Users can search tenant videos"
  ON video_search_index FOR SELECT
  USING (
    video_id IN (
      SELECT id FROM videos WHERE tenant_id IN (
        SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
      )
    )
  );
