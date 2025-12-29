-- Migration: Add crop bounds columns to cropped_frames table
-- This migration adds crop_left, crop_top, crop_right, crop_bottom columns
-- to store the actual crop bounds used for each frame (in addition to version)

-- Note: SQLite doesn't support adding NOT NULL columns with ALTER TABLE unless we provide a DEFAULT
-- We'll add them as nullable first, then we can populate them from video_layout_config

-- Add crop bounds columns (nullable initially for compatibility)
ALTER TABLE cropped_frames ADD COLUMN crop_left INTEGER;
ALTER TABLE cropped_frames ADD COLUMN crop_top INTEGER;
ALTER TABLE cropped_frames ADD COLUMN crop_right INTEGER;
ALTER TABLE cropped_frames ADD COLUMN crop_bottom INTEGER;

-- Populate existing rows with bounds from video_layout_config
-- This assumes crop_bounds_version matches the current config
UPDATE cropped_frames
SET
    crop_left = (SELECT crop_left FROM video_layout_config WHERE id = 1),
    crop_top = (SELECT crop_top FROM video_layout_config WHERE id = 1),
    crop_right = (SELECT crop_right FROM video_layout_config WHERE id = 1),
    crop_bottom = (SELECT crop_bottom FROM video_layout_config WHERE id = 1)
WHERE crop_left IS NULL;
