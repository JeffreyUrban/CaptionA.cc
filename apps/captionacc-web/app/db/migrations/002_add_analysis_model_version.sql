-- Migration: Add analysis_model_version to video_layout_config
-- Tracks which model version was used to produce current crop bounds

-- Add column (safe to run multiple times due to IF NOT EXISTS check in migration code)
ALTER TABLE video_layout_config ADD COLUMN analysis_model_version TEXT;

-- Populate with current model version for existing layouts
-- (NULL means needs recalculation on next check)
UPDATE video_layout_config
SET analysis_model_version = (
    SELECT model_version FROM box_classification_model WHERE id = 1
)
WHERE id = 1 AND analysis_model_version IS NULL;
