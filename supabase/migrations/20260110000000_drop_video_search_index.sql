-- Drop video_search_index table and related objects
-- This feature is being deprecated as full-text search across videos is not needed

-- ============================================================================
-- Drop from captionacc_staging schema FIRST (depends on production sequence)
-- ============================================================================

-- Drop RLS policies (staging may not have all policies)
DROP POLICY IF EXISTS "Users can search tenant videos" ON captionacc_staging.video_search_index;
DROP POLICY IF EXISTS "Platform admins can search all videos" ON captionacc_staging.video_search_index;
DROP POLICY IF EXISTS "Owners can search tenant videos" ON captionacc_staging.video_search_index;

-- Drop indexes
DROP INDEX IF EXISTS captionacc_staging.idx_search_video;
DROP INDEX IF EXISTS captionacc_staging.idx_search_text;

-- Drop the table
DROP TABLE IF EXISTS captionacc_staging.video_search_index;

-- ============================================================================
-- Drop from captionacc_production schema
-- ============================================================================

-- Drop RLS policies first
DROP POLICY IF EXISTS "Users can search tenant videos" ON captionacc_production.video_search_index;
DROP POLICY IF EXISTS "Platform admins can search all videos" ON captionacc_production.video_search_index;
DROP POLICY IF EXISTS "Owners can search tenant videos" ON captionacc_production.video_search_index;

-- Drop indexes
DROP INDEX IF EXISTS captionacc_production.idx_search_video;
DROP INDEX IF EXISTS captionacc_production.idx_search_text;

-- Drop the table
DROP TABLE IF EXISTS captionacc_production.video_search_index;
