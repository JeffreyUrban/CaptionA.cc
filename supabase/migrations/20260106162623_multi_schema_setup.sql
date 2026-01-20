-- Multi-Schema Setup for CaptionA.cc
-- Consolidates multiple Supabase projects into one using PostgreSQL schemas
--
-- Schemas:
--   - captionacc_prod: Main alpha/production environment
--   - captionacc_staging: Testing/review apps environment
--   - captionacc_prefect: Prefect Server database (optional, for self-hosted Prefect)
--   - umami: Umami analytics database
--
-- Note: This migration creates the schema structure.
-- Data migration from public → captionacc_prod must be done separately.

-- ============================================================================
-- Create Schemas
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS captionacc_prod;
CREATE SCHEMA IF NOT EXISTS captionacc_staging;
CREATE SCHEMA IF NOT EXISTS captionacc_prefect;
CREATE SCHEMA IF NOT EXISTS umami;

-- ============================================================================
-- Grant Permissions on Schemas
-- ============================================================================

-- Production schema
GRANT USAGE ON SCHEMA captionacc_prod TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA captionacc_prod TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA captionacc_prod TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA captionacc_prod TO postgres, anon, authenticated, service_role;

-- Staging schema
GRANT USAGE ON SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;

-- Prefect schema (for optional self-hosted Prefect Server)
GRANT USAGE ON SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;

-- Umami schema (for Umami analytics)
GRANT USAGE ON SCHEMA umami TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA umami TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA umami TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA umami TO postgres, anon, authenticated, service_role;

-- ============================================================================
-- Set Default Privileges for Future Objects
-- ============================================================================

-- Production schema
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prod GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prod GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prod GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- Staging schema
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_staging GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_staging GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_staging GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- Prefect schema
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prefect GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prefect GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prefect GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- Umami schema
ALTER DEFAULT PRIVILEGES IN SCHEMA umami GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA umami GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA umami GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- ============================================================================
-- Helper Function: Copy Schema Structure
-- ============================================================================

CREATE OR REPLACE FUNCTION copy_schema_structure(
  source_schema text,
  target_schema text,
  include_data boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  table_record record;
  seq_record record;
  func_record record;
BEGIN
  -- Copy tables
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = source_schema
  LOOP
    IF include_data THEN
      -- Copy table with data
      EXECUTE format('CREATE TABLE %I.%I (LIKE %I.%I INCLUDING ALL)',
        target_schema, table_record.tablename,
        source_schema, table_record.tablename);
      EXECUTE format('INSERT INTO %I.%I SELECT * FROM %I.%I',
        target_schema, table_record.tablename,
        source_schema, table_record.tablename);
    ELSE
      -- Copy table structure only
      EXECUTE format('CREATE TABLE %I.%I (LIKE %I.%I INCLUDING ALL)',
        target_schema, table_record.tablename,
        source_schema, table_record.tablename);
    END IF;
  END LOOP;

  -- Copy sequences
  FOR seq_record IN
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = source_schema
  LOOP
    EXECUTE format('CREATE SEQUENCE %I.%I',
      target_schema, seq_record.sequencename);
  END LOOP;

  -- Copy functions
  FOR func_record IN
    SELECT routine_name, routine_definition
    FROM information_schema.routines
    WHERE routine_schema = source_schema
  LOOP
    -- Note: This is simplified; full function copying is complex
    -- May need manual replication for complex functions
    RAISE NOTICE 'Function % needs manual replication', func_record.routine_name;
  END LOOP;

  RAISE NOTICE 'Schema structure copied from % to %', source_schema, target_schema;
END;
$$;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON SCHEMA captionacc_prod IS 'Production/alpha environment for CaptionA.cc application';
COMMENT ON SCHEMA captionacc_staging IS 'Staging/testing environment for CaptionA.cc application';
COMMENT ON SCHEMA captionacc_prefect IS 'Prefect workflow orchestration database (optional self-hosted)';
COMMENT ON SCHEMA umami IS 'Umami web analytics database';

-- ============================================================================
-- Migration Instructions
-- ============================================================================

-- After running this migration, you need to:
--
-- 1. Copy data from public schema to captionacc_prod:
--    SELECT copy_schema_structure('public', 'captionacc_prod', true);
--
-- 2. Copy structure (no data) to captionacc_staging:
--    SELECT copy_schema_structure('public', 'captionacc_staging', false);
--    -- OR manually recreate using existing migrations:
--    -- SET search_path TO captionacc_staging;
--    -- Run all existing migrations
--
-- 3. Update application code to use schema parameter:
--    - Set SUPABASE_SCHEMA=captionacc_prod for production
--    - Set SUPABASE_SCHEMA=captionacc_staging for staging
--
-- 4. For Prefect Server (optional):
--    - Point Prefect to captionacc_prefect schema
--    - Run: prefect server database upgrade
--
-- 5. For Umami analytics:
--    - Point Umami to umami schema
--    - Run Umami migrations
--
-- 6. Once verified, optionally clean up public schema:
--    -- DROP TABLE captionacc_prod.tenants CASCADE;
--    -- etc.
