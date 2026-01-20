-- Add width and height columns to videos table
-- These columns store video dimensions for display and processing
-- Default to 0 for unknown dimensions (will be updated during processing)

ALTER TABLE captionacc_prod.videos
  ADD COLUMN IF NOT EXISTS width INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS height INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN captionacc_prod.videos.width IS 'Video width in pixels (0 if unknown)';
COMMENT ON COLUMN captionacc_prod.videos.height IS 'Video height in pixels (0 if unknown)';
