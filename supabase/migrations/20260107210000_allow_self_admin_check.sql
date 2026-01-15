-- Allow users to check if THEY are a platform admin (for UI display only)
-- This is safe because users can only see their own row
-- Real authorization still happens server-side in route loaders

CREATE POLICY "Users can check their own admin status"
  ON captionacc_production.platform_admins FOR SELECT
  USING (user_id = auth.uid());
