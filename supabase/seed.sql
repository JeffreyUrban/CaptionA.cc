-- Seed data for CaptionA.cc
-- Run this after the initial migration to set up demo data and storage buckets

-- Storage buckets are already configured in config.toml
-- Additional bucket policies and RLS can be added here

-- Create storage buckets (if not exists from config.toml)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('thumbnails', 'thumbnails', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('videos', 'videos', false, 524288000, ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']),
  ('databases', 'databases', false, 104857600, ARRAY['application/x-sqlite3', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars bucket
CREATE POLICY "Users can view all avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage policies for thumbnails bucket
CREATE POLICY "Users can view tenant thumbnails"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'thumbnails'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can upload thumbnails for tenant"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update tenant thumbnails"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'thumbnails'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tenant thumbnails"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'thumbnails'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Storage policies for videos bucket
CREATE POLICY "Users can view tenant videos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can upload videos for tenant"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update tenant videos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tenant videos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'videos'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Storage policies for databases bucket
CREATE POLICY "Users can view tenant databases"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'databases'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can upload databases for tenant"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'databases'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update tenant databases"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'databases'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tenant databases"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'databases'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Create demo tenant
INSERT INTO tenants (id, name, slug, storage_quota_gb)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Demo Organization', 'demo', 100)
ON CONFLICT (id) DO NOTHING;

-- Note: Demo users will be created through the authentication flow
-- This ensures proper auth.users integration
