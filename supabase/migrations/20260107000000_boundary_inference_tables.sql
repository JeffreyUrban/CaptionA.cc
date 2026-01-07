-- Boundary inference run tracking tables
-- Stores metadata for completed inference runs and active job queue

-- Completed inference runs (registry with Wasabi storage location)
CREATE TABLE IF NOT EXISTS captionacc_production.boundary_inference_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT UNIQUE NOT NULL,                  -- UUID from filename
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Versioning (for fast lookups)
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,                  -- Full hash/identifier
  model_checkpoint_path TEXT,

  -- Wasabi storage location
  wasabi_storage_key TEXT NOT NULL,             -- Full path: videos/{tenant}/{video}/boundaries/{filename}
  file_size_bytes BIGINT,

  -- Run metadata
  total_pairs INTEGER NOT NULL,                 -- 25k for typical video
  processing_time_seconds REAL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Composite unique: one run per video+version+model combination
  UNIQUE(video_id, cropped_frames_version, model_version)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_inference_runs_video
  ON captionacc_production.boundary_inference_runs(video_id);

CREATE INDEX IF NOT EXISTS idx_inference_runs_version_model
  ON captionacc_production.boundary_inference_runs(video_id, cropped_frames_version, model_version);

CREATE INDEX IF NOT EXISTS idx_inference_runs_model
  ON captionacc_production.boundary_inference_runs(model_version);

CREATE INDEX IF NOT EXISTS idx_inference_runs_tenant
  ON captionacc_production.boundary_inference_runs(tenant_id);

-- Active job queue (transient, for monitoring)
CREATE TABLE IF NOT EXISTS captionacc_production.boundary_inference_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,

  -- Job metadata
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'low')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  -- Link to completed run (if successful)
  inference_run_id UUID REFERENCES captionacc_production.boundary_inference_runs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for job queue queries
CREATE INDEX IF NOT EXISTS idx_inference_jobs_video
  ON captionacc_production.boundary_inference_jobs(video_id);

CREATE INDEX IF NOT EXISTS idx_inference_jobs_status
  ON captionacc_production.boundary_inference_jobs(status);

CREATE INDEX IF NOT EXISTS idx_inference_jobs_priority_status
  ON captionacc_production.boundary_inference_jobs(priority, status);

-- RLS Policies for boundary_inference_runs
ALTER TABLE captionacc_production.boundary_inference_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tenant inference runs"
  ON captionacc_production.boundary_inference_runs FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()
    )
  );

-- RLS Policies for boundary_inference_jobs
ALTER TABLE captionacc_production.boundary_inference_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tenant inference jobs"
  ON captionacc_production.boundary_inference_jobs FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()
    )
  );

-- Comments for documentation
COMMENT ON TABLE captionacc_production.boundary_inference_runs IS
  'Registry of completed boundary inference runs with Wasabi storage locations';

COMMENT ON TABLE captionacc_production.boundary_inference_jobs IS
  'Active and historical inference job queue for monitoring';

COMMENT ON COLUMN captionacc_production.boundary_inference_runs.wasabi_storage_key IS
  'Full Wasabi path to boundaries database file';

COMMENT ON COLUMN captionacc_production.boundary_inference_runs.total_pairs IS
  'Number of frame pairs processed (typically ~25k for a full video)';
