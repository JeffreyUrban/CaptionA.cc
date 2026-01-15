-- Add display_path column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'captionacc_production'
    AND table_name = 'videos'
    AND column_name = 'display_path'
  ) THEN
    ALTER TABLE captionacc_production.videos ADD COLUMN display_path TEXT;
    UPDATE captionacc_production.videos SET display_path = video_path WHERE display_path IS NULL;
    COMMENT ON COLUMN captionacc_production.videos.display_path IS 'Display path for organizing videos in folders (e.g., "level1/video_name")';
  END IF;
END $$;
