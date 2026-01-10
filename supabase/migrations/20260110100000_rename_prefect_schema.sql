-- Rename captionacc_prefect schema to prefect
-- Aligns with naming convention: service schemas use their service name directly
-- (like 'umami' for Umami analytics)

-- Rename the schema
ALTER SCHEMA captionacc_prefect RENAME TO prefect;

-- Update the comment
COMMENT ON SCHEMA prefect IS 'Prefect workflow orchestration database (optional self-hosted)';
