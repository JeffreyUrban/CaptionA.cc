-- Add cropped frames versioning support
-- Allows tracking multiple versions of cropped framesets for ML training reproducibility

-- Track cropped frame versions per video
CREATE TABLE cropped_frames_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Version tracking
  version INTEGER NOT NULL,

  -- Storage location
  storage_prefix TEXT NOT NULL,  -- {tenant_id}/{video_id}/cropped_frames_v{version}/

  -- Generation metadata
  layout_db_storage_key TEXT,  -- Wasabi key for layout.db used
  layout_db_hash TEXT,          -- SHA-256 hash of layout.db
  crop_bounds JSONB,            -- Crop bounds used: {left, top, right, bottom}
  frame_rate REAL DEFAULT 10.0, -- Hz

  -- Chunk metadata
  chunk_count INTEGER,          -- Number of WebM chunks generated
  total_frames INTEGER,         -- Total frames across all chunks
  total_size_bytes BIGINT,      -- Total size of all chunks

  -- Status tracking
  status TEXT DEFAULT 'processing' CHECK (
    status IN ('processing', 'active', 'archived', 'failed')
  ),

  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,     -- When this version became active
  archived_at TIMESTAMPTZ,      -- When this version was archived

  -- Prefect integration
  prefect_flow_run_id UUID,

  -- Ensure unique versions per video
  UNIQUE(video_id, version)
);

CREATE INDEX idx_cropped_frames_versions_video ON cropped_frames_versions(video_id);
CREATE INDEX idx_cropped_frames_versions_tenant ON cropped_frames_versions(tenant_id);
CREATE INDEX idx_cropped_frames_versions_status ON cropped_frames_versions(status);

-- Add current version tracking to videos table
ALTER TABLE videos ADD COLUMN current_cropped_frames_version INTEGER;

-- Enable RLS
ALTER TABLE cropped_frames_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see versions for videos in their tenant
CREATE POLICY "Users can view tenant video cropped frames versions"
  ON cropped_frames_versions FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- RLS Policy: Users can insert versions for videos in their tenant
CREATE POLICY "Users can create cropped frames versions"
  ON cropped_frames_versions FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- RLS Policy: Users can update versions for videos in their tenant
CREATE POLICY "Users can update cropped frames versions"
  ON cropped_frames_versions FOR UPDATE
  USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- Function to get next version number for a video
CREATE OR REPLACE FUNCTION get_next_cropped_frames_version(p_video_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1
  INTO next_version
  FROM cropped_frames_versions
  WHERE video_id = p_video_id;

  RETURN next_version;
END;
$$;

-- Function to activate a cropped frames version
-- This marks the specified version as 'active' and archives the previous active version
CREATE OR REPLACE FUNCTION activate_cropped_frames_version(
  p_version_id UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_video_id UUID;
  v_version INTEGER;
BEGIN
  -- Get video_id and version for the version being activated
  SELECT video_id, version
  INTO v_video_id, v_version
  FROM cropped_frames_versions
  WHERE id = p_version_id;

  IF v_video_id IS NULL THEN
    RAISE EXCEPTION 'Version not found: %', p_version_id;
  END IF;

  -- Archive the previous active version
  UPDATE cropped_frames_versions
  SET
    status = 'archived',
    archived_at = NOW()
  WHERE
    video_id = v_video_id
    AND status = 'active';

  -- Activate the new version
  UPDATE cropped_frames_versions
  SET
    status = 'active',
    activated_at = NOW()
  WHERE id = p_version_id;

  -- Update current version pointer in videos table
  UPDATE videos
  SET current_cropped_frames_version = v_version
  WHERE id = v_video_id;
END;
$$;
