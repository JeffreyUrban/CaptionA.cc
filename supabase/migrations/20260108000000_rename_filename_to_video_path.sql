-- Rename videos.filename to videos.video_path for clarity
-- This field stores the display path (e.g., "level1/video") not the actual filename

ALTER TABLE captionacc_production.videos
  RENAME COLUMN filename TO video_path;

COMMENT ON COLUMN captionacc_production.videos.video_path IS 'Display path for video (e.g., "level1/video") used for UI tree structure';
