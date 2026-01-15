-- Auto-create user profiles when users sign up
-- This handles the case where users authenticate but don't have a profile record

-- First, ensure we have a default tenant for users without one
-- Check if default tenant exists, create if not
DO $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  -- Try to get an existing tenant
  SELECT id INTO v_default_tenant_id
  FROM captionacc_production.tenants
  LIMIT 1;

  -- If no tenant exists, create a default one
  IF v_default_tenant_id IS NULL THEN
    INSERT INTO captionacc_production.tenants (name, slug, created_at)
    VALUES ('Default Tenant', 'default', NOW())
    RETURNING id INTO v_default_tenant_id;

    RAISE NOTICE 'Created default tenant with id: %', v_default_tenant_id;
  ELSE
    RAISE NOTICE 'Using existing tenant with id: %', v_default_tenant_id;
  END IF;
END $$;

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION captionacc_production.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Get the first available tenant (or create one if none exists)
  SELECT id INTO v_tenant_id
  FROM captionacc_production.tenants
  LIMIT 1;

  -- Create user profile with default values
  INSERT INTO captionacc_production.user_profiles (
    id,
    tenant_id,
    full_name,
    role,
    approval_status,
    access_tier_id,
    created_at
  )
  VALUES (
    NEW.id,
    v_tenant_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'member',
    'approved', -- Auto-approve for now - adjust based on your needs
    'demo',
    NOW()
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent duplicate key errors

  RETURN NEW;
END;
$$;

-- Create trigger on auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION captionacc_production.handle_new_user();

-- Backfill: Create profiles for any existing users without profiles
DO $$
DECLARE
  v_tenant_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Get the first available tenant
  SELECT id INTO v_tenant_id
  FROM captionacc_production.tenants
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant found. Cannot create user profiles.';
  END IF;

  -- Insert profiles for users that don't have them
  INSERT INTO captionacc_production.user_profiles (
    id,
    tenant_id,
    full_name,
    role,
    approval_status,
    access_tier_id,
    created_at
  )
  SELECT
    u.id,
    v_tenant_id,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email),
    'member',
    'approved', -- Auto-approve existing users
    'demo',
    NOW()
  FROM auth.users u
  LEFT JOIN captionacc_production.user_profiles up ON u.id = up.id
  WHERE up.id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    RAISE NOTICE 'Created % user profile(s) for existing users', v_count;
  ELSE
    RAISE NOTICE 'All existing users already have profiles';
  END IF;
END $$;
