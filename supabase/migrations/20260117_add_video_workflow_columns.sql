-- Add workflow stage tracking and stats to videos table
-- Migration: Add columns for video workflow stages and statistics

-- Add workflow status columns
ALTER TABLE captionacc_prod.videos
  ADD COLUMN layout_status TEXT DEFAULT 'wait' CHECK (layout_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  ADD COLUMN boundaries_status TEXT DEFAULT 'wait' CHECK (boundaries_status IN ('wait', 'annotate', 'done', 'review', 'error')),
  ADD COLUMN text_status TEXT DEFAULT 'wait' CHECK (text_status IN ('wait', 'annotate', 'done', 'review', 'error'));

-- Add stats columns (updated by Prefect flows and captionacc-api)
ALTER TABLE captionacc_prod.videos
  ADD COLUMN total_frames INTEGER DEFAULT 0,
  ADD COLUMN covered_frames INTEGER DEFAULT 0,
  ADD COLUMN total_annotations INTEGER DEFAULT 0,
  ADD COLUMN confirmed_annotations INTEGER DEFAULT 0,
  ADD COLUMN predicted_annotations INTEGER DEFAULT 0,
  ADD COLUMN boundary_pending_count INTEGER DEFAULT 0,
  ADD COLUMN text_pending_count INTEGER DEFAULT 0;

-- Add error tracking columns
ALTER TABLE captionacc_prod.videos
  ADD COLUMN layout_error_details JSONB,
  ADD COLUMN boundaries_error_details JSONB,
  ADD COLUMN text_error_details JSONB;

-- Remove deprecated status column
ALTER TABLE captionacc_prod.videos
  DROP COLUMN IF EXISTS status;

-- Add indexes for filtering by workflow status
CREATE INDEX idx_videos_layout_status ON captionacc_prod.videos(layout_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_boundaries_status ON captionacc_prod.videos(boundaries_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_text_status ON captionacc_prod.videos(text_status) WHERE deleted_at IS NULL;

-- Add comment explaining the design
COMMENT ON COLUMN captionacc_prod.videos.layout_status IS 'User action state: wait (processing), annotate (ready), done (approved), review (needs review), error';
COMMENT ON COLUMN captionacc_prod.videos.boundaries_status IS 'User action state: wait (needs layout), annotate (ready), done (complete), review (needs review), error';
COMMENT ON COLUMN captionacc_prod.videos.text_status IS 'User action state: wait (needs boundaries), annotate (ready), done (complete), review (needs review), error';
