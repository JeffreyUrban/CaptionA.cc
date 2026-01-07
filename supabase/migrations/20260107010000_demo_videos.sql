-- Demo Videos Migration
-- Adds support for shared read-only demo videos accessible to all users

-- Add demo fields to videos table
ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS display_path TEXT;

-- Update display_path from existing data
-- For videos already in Supabase, use filename as display_path
UPDATE videos SET display_path = filename WHERE display_path IS NULL;

-- RLS Policy: Demo videos visible to all authenticated users
CREATE POLICY "Anyone can view demo videos"
  ON videos FOR SELECT
  USING (
    is_demo = TRUE
    AND deleted_at IS NULL
  );

-- RLS Policy: Only platform admins can modify demo videos
CREATE POLICY "Only admins can modify demo videos"
  ON videos FOR UPDATE
  USING (
    is_demo = TRUE
    AND is_platform_admin()
  );

-- RLS Policy: Only platform admins can delete demo videos
CREATE POLICY "Only admins can delete demo videos"
  ON videos FOR DELETE
  USING (
    is_demo = TRUE
    AND is_platform_admin()
  );

-- Comments for documentation
COMMENT ON COLUMN videos.is_demo IS 'True if video is a demo/sample video accessible to all users (read-only)';
COMMENT ON COLUMN videos.display_path IS 'Display path for organizing videos in folders (e.g., "level1/video_name")';
COMMENT ON COLUMN videos.uploaded_at IS 'Upload timestamp - determines annotation access order for trial tier (first 3 uploaded)';
COMMENT ON COLUMN videos.deleted_at IS 'Soft delete timestamp - deleted videos count toward trial tier annotation limits';
