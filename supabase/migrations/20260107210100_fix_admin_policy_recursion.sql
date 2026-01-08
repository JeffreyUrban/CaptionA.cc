-- Fix infinite recursion in platform_admins RLS policies
-- The "Platform admins see each other" policy causes recursion because it queries
-- the same table it's protecting. We'll replace it with a simpler approach.

-- Drop the recursive policy
DROP POLICY IF EXISTS "Platform admins see each other" ON captionacc_production.platform_admins;

-- Keep only the simple self-check policy (already created in previous migration)
-- Users can check their own admin status: user_id = auth.uid()

-- Note: If we need admins to see all admins in the future, we can:
-- 1. Use a security definer function that bypasses RLS
-- 2. Use service role on server-side
-- 3. Store a flag in auth.users metadata
