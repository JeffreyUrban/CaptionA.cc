-- Update auth trigger to create user profiles in both prod and dev schemas
-- This ensures users can work seamlessly in both environments
--
-- When a user signs up via auth.users, their profile is created in BOTH:
-- - captionacc_prod.user_profiles
-- - captionacc_dev.user_profiles

-- Ensure captionacc_dev has a default tenant
DO $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  -- Try to get an existing tenant in dev schema
  SELECT id INTO v_default_tenant_id
  FROM captionacc_dev.tenants
  LIMIT 1;

  -- If no tenant exists, create a default one
  IF v_default_tenant_id IS NULL THEN
    INSERT INTO captionacc_dev.tenants (name, slug, created_at)
    VALUES ('Default Dev Tenant', 'default-dev', NOW())
    RETURNING id INTO v_default_tenant_id;

    RAISE NOTICE 'Created default dev tenant with id: %', v_default_tenant_id;
  ELSE
    RAISE NOTICE 'Dev schema already has tenant with id: %', v_default_tenant_id;
  END IF;
END $$;

-- Updated function to handle new user creation in BOTH schemas
CREATE OR REPLACE FUNCTION captionacc_prod.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_prod_tenant_id UUID;
  v_dev_tenant_id UUID;
BEGIN
  -- Get tenant for prod schema
  SELECT id INTO v_prod_tenant_id
  FROM captionacc_prod.tenants
  LIMIT 1;

  -- Get tenant for dev schema
  SELECT id INTO v_dev_tenant_id
  FROM captionacc_dev.tenants
  LIMIT 1;

  -- Create user profile in PROD schema
  IF v_prod_tenant_id IS NOT NULL THEN
    INSERT INTO captionacc_prod.user_profiles (
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
      v_prod_tenant_id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      'member',
      'approved',
      'demo',
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Create user profile in DEV schema
  IF v_dev_tenant_id IS NOT NULL THEN
    INSERT INTO captionacc_dev.user_profiles (
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
      v_dev_tenant_id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      'member',
      'approved',
      'demo',
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: Create profiles in dev schema for existing users
DO $$
DECLARE
  v_tenant_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Get the first available tenant in dev schema
  SELECT id INTO v_tenant_id
  FROM captionacc_dev.tenants
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'No tenant in dev schema. Skipping backfill.';
    RETURN;
  END IF;

  -- Insert profiles for users that don't have them in dev schema
  INSERT INTO captionacc_dev.user_profiles (
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
    'approved',
    'demo',
    NOW()
  FROM auth.users u
  LEFT JOIN captionacc_dev.user_profiles up ON u.id = up.id
  WHERE up.id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    RAISE NOTICE 'Created % user profile(s) in dev schema for existing users', v_count;
  ELSE
    RAISE NOTICE 'All existing users already have profiles in dev schema';
  END IF;
END $$;

-- Notify PostgREST to reload
NOTIFY pgrst, 'reload schema';
