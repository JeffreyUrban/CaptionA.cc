-- Remove redundant storage_key and video_path columns from videos table
-- Storage key can be computed as: {tenant_id}/client/videos/{video_id}/video.mp4
-- Only display_path is needed for user-facing organization

-- Drop columns
ALTER TABLE captionacc_prod.videos
  DROP COLUMN IF EXISTS storage_key,
  DROP COLUMN IF EXISTS video_path;

-- Add comment explaining the design
COMMENT ON TABLE captionacc_prod.videos IS 'Video catalog with metadata. Storage key is computed as {tenant_id}/client/videos/{video_id}/video.mp4. Only display_path is stored for user-facing organization.';
