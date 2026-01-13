-- CR-SQLite Sync: video_database_state table
-- Tracks versioning, working copies, and locks for per-video SQLite databases

-- ============================================================================
-- TABLE
-- ============================================================================

CREATE TABLE captionacc_production.video_database_state (
  -- Composite primary key
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id) ON DELETE CASCADE,
  database_name TEXT NOT NULL CHECK (database_name IN ('layout', 'captions')),
  tenant_id UUID NOT NULL REFERENCES captionacc_production.tenants(id) ON DELETE CASCADE,

  -- Versioning
  server_version BIGINT NOT NULL DEFAULT 0,      -- Increments on every change (authoritative)
  wasabi_version BIGINT NOT NULL DEFAULT 0,      -- Version currently in Wasabi (cold storage)
  wasabi_synced_at TIMESTAMPTZ,                  -- When Wasabi was last updated

  -- Working Copy
  working_copy_path TEXT,                        -- Local filesystem path on server

  -- Lock (user-level, not session-level)
  lock_holder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lock_type TEXT CHECK (lock_type IN ('client', 'server')),
  locked_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,                  -- Last change (for idle timeout)

  -- Active Connection (for routing only, not locking)
  active_connection_id TEXT,                     -- WebSocket connection ID

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (video_id, database_name)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Find databases needing Wasabi upload (idle with unsaved changes)
CREATE INDEX idx_vds_pending_upload ON captionacc_production.video_database_state(last_activity_at)
    WHERE server_version > wasabi_version;

-- Find databases locked by a user
CREATE INDEX idx_vds_lock_holder ON captionacc_production.video_database_state(lock_holder_user_id)
    WHERE lock_holder_user_id IS NOT NULL;

-- Tenant lookup for RLS
CREATE INDEX idx_vds_tenant ON captionacc_production.video_database_state(tenant_id);

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE captionacc_production.video_database_state ENABLE ROW LEVEL SECURITY;

-- Users can view state for databases in their tenant
CREATE POLICY "Users view own tenant database state"
  ON captionacc_production.video_database_state FOR SELECT
  USING (tenant_id = captionacc_production.current_user_tenant_id());

-- Service role can do anything (used by API backend)
-- Note: API uses service_role key which bypasses RLS

-- Platform admins can view all
CREATE POLICY "Platform admins view all database state"
  ON captionacc_production.video_database_state FOR SELECT
  USING (captionacc_production.is_platform_admin());

-- ============================================================================
-- TRIGGER: Update updated_at on change
-- ============================================================================

CREATE OR REPLACE FUNCTION captionacc_production.update_video_database_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_database_state_updated_at
  BEFORE UPDATE ON captionacc_production.video_database_state
  FOR EACH ROW
  EXECUTE FUNCTION captionacc_production.update_video_database_state_updated_at();

-- ============================================================================
-- NOTIFY POSTGREST
-- ============================================================================

NOTIFY pgrst, 'reload schema';
