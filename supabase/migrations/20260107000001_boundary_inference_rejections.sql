-- Boundary inference rejection tracking
-- Records jobs that were rejected before reaching Modal (validation failures)

CREATE TABLE IF NOT EXISTS captionacc_production.boundary_inference_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,

  -- Rejection reason
  rejection_type TEXT NOT NULL CHECK (rejection_type IN (
    'frame_count_exceeded',      -- Video too long
    'cost_exceeded',              -- Estimated cost too high
    'validation_failed',          -- Input validation failed
    'rate_limited',               -- Too many recent requests
    'queue_full'                  -- Queue depth exceeded
  )),
  rejection_message TEXT NOT NULL,

  -- Video/job details at time of rejection
  frame_count INTEGER,
  estimated_cost_usd REAL,
  cropped_frames_version INTEGER,
  model_version TEXT,
  priority TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged BOOLEAN DEFAULT FALSE,      -- Whether team has reviewed
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id)
);

-- Indexes for monitoring queries
CREATE INDEX IF NOT EXISTS idx_inference_rejections_video
  ON captionacc_production.boundary_inference_rejections(video_id);

CREATE INDEX IF NOT EXISTS idx_inference_rejections_type
  ON captionacc_production.boundary_inference_rejections(rejection_type);

CREATE INDEX IF NOT EXISTS idx_inference_rejections_unacknowledged
  ON captionacc_production.boundary_inference_rejections(acknowledged, created_at)
  WHERE NOT acknowledged;

CREATE INDEX IF NOT EXISTS idx_inference_rejections_recent
  ON captionacc_production.boundary_inference_rejections(created_at DESC);

-- RLS Policies
ALTER TABLE captionacc_production.boundary_inference_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tenant rejection logs"
  ON captionacc_production.boundary_inference_rejections FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can acknowledge tenant rejections"
  ON captionacc_production.boundary_inference_rejections FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM captionacc_production.user_profiles WHERE id = auth.uid()
    )
  );

-- Comments
COMMENT ON TABLE captionacc_production.boundary_inference_rejections IS
  'Logs of inference jobs rejected during validation (before reaching Modal GPU)';

COMMENT ON COLUMN captionacc_production.boundary_inference_rejections.rejection_type IS
  'Category of rejection: frame_count_exceeded, cost_exceeded, validation_failed, rate_limited, queue_full';

COMMENT ON COLUMN captionacc_production.boundary_inference_rejections.acknowledged IS
  'Whether team has reviewed this rejection and taken action';
