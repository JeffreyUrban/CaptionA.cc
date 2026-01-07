-- Access Tiers Migration
-- Implements tiered access control system (demo/trial/active)
-- Separates feature access from billing/payment concerns

-- Access tiers table
-- Defines what features each tier can access
CREATE TABLE IF NOT EXISTS access_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  features JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add access tier fields to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS access_tier_id TEXT DEFAULT 'demo' REFERENCES access_tiers(id),
  ADD COLUMN IF NOT EXISTS access_notes TEXT;

-- Insert tier definitions
INSERT INTO access_tiers (id, name, description, features) VALUES
  ('demo', 'Demo Access', 'Read-only access to demo videos only', '{
    "max_videos": 0,
    "max_storage_gb": 0,
    "annotation": false,
    "export": false,
    "upload": false,
    "demo_access": true
  }'),
  ('trial', 'Trial Access', 'Upload up to 3 videos with annotation access on first 3 uploaded', '{
    "max_videos": 3,
    "max_storage_gb": 1,
    "annotation": true,
    "annotation_video_limit": 3,
    "export": true,
    "upload": true,
    "demo_access": true
  }'),
  ('active', 'Active Access', 'Full access to all features', '{
    "max_videos": 1000,
    "max_storage_gb": 100,
    "annotation": true,
    "export": true,
    "upload": true,
    "demo_access": true
  }')
ON CONFLICT (id) DO NOTHING;

-- Function to check feature access
CREATE OR REPLACE FUNCTION has_feature_access(
  p_user_id UUID,
  p_feature TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_tier_id TEXT;
  v_features JSONB;
BEGIN
  SELECT access_tier_id INTO v_tier_id
  FROM user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT features INTO v_features
  FROM access_tiers
  WHERE id = v_tier_id;

  RETURN COALESCE((v_features->p_feature)::BOOLEAN, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Update existing users to 'active' tier (grandfather preview users)
UPDATE user_profiles
SET access_tier_id = 'active'
WHERE access_tier_id IS NULL OR access_tier_id = 'demo';

-- Comments for documentation
COMMENT ON TABLE access_tiers IS 'Defines feature access levels. Billing/payment managed separately.';
COMMENT ON COLUMN user_profiles.access_tier_id IS 'User access level - controls feature access independent of billing';
COMMENT ON COLUMN user_profiles.access_notes IS 'Admin notes about why tier was changed';
COMMENT ON FUNCTION has_feature_access IS 'Check if user has access to a specific feature based on their tier';
