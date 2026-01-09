-- Remove ALL policies on platform_admins and recreate only the simple self-check policy
-- The other policies cause infinite recursion because they query the same table they protect

-- Drop all existing policies
DROP POLICY IF EXISTS "Platform admins see each other" ON captionacc_production.platform_admins;
DROP POLICY IF EXISTS "Platform admins manage admin grants" ON captionacc_production.platform_admins;
DROP POLICY IF EXISTS "Users can check their own admin status" ON captionacc_production.platform_admins;

-- Create only the simple self-check policy (no recursion)
-- Users can query if they themselves are an admin (for UI display only)
CREATE POLICY "Users can check their own admin status"
  ON captionacc_production.platform_admins FOR SELECT
  USING (user_id = auth.uid());

-- Note: Admin management (INSERT/UPDATE/DELETE) should be done server-side with service role
-- This bypasses RLS entirely, avoiding recursion issues
