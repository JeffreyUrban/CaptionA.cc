-- Rename captionacc_production schema to captionacc_prod
-- This migration handles the schema rename for namespace isolation support
--
-- IMPORTANT: This migration is idempotent - safe to run multiple times
-- It checks if the old schema exists before attempting rename

DO $$
BEGIN
  -- Only rename if old schema exists and new schema doesn't
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'captionacc_production')
     AND NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'captionacc_prod')
  THEN
    ALTER SCHEMA captionacc_production RENAME TO captionacc_prod;
    RAISE NOTICE 'Schema renamed: captionacc_production -> captionacc_prod';
  ELSIF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'captionacc_prod')
  THEN
    RAISE NOTICE 'Schema captionacc_prod already exists, no rename needed';
  ELSE
    RAISE NOTICE 'Neither captionacc_production nor captionacc_prod exists - will be created by other migrations';
  END IF;
END $$;

-- Update search_path references if needed
-- Note: This affects the current session only; config.toml handles the default

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
