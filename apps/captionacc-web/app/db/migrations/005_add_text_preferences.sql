-- Migration: Add text_size, padding_scale, and text_anchor to video_preferences
-- These columns control text rendering preferences for caption images

-- Add text_size column (text size as percentage of image width, 1.0-10.0)
ALTER TABLE video_preferences ADD COLUMN text_size REAL DEFAULT 3.0;

-- Add padding_scale column (padding scale multiplier, 0.0-2.0)
ALTER TABLE video_preferences ADD COLUMN padding_scale REAL DEFAULT 0.75;

-- Add text_anchor column (text alignment: left, center, or right)
ALTER TABLE video_preferences ADD COLUMN text_anchor TEXT DEFAULT 'left' CHECK(text_anchor IN ('left', 'center', 'right'));
