/**
 * Video List API
 *
 * Returns video catalog filtered by RLS policies.
 * Users see only their own videos (tenant isolation enforced by RLS).
 */

import { redirect, type LoaderFunctionArgs } from 'react-router'

import { createServerSupabaseClient } from '~/services/supabase-client'
import { jsonResponse } from '~/utils/api-responses'

export async function loader({ request: _request }: LoaderFunctionArgs) {
  const supabase = createServerSupabaseClient()

  // Get authenticated user
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (!user || error) {
    throw redirect('/auth/login')
  }

  // Query videos table - RLS automatically filters by tenant/user
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('id, filename, display_path, status, uploaded_at, is_demo')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })

  if (videosError) {
    console.error('Failed to fetch videos:', videosError)
    return jsonResponse({ videos: [] })
  }

  // Transform to VideoInfo format expected by tree builder
  const videoList =
    videos?.map(v => ({
      videoId: v.id,
      displayPath: v.display_path || v.filename || v.id,
      isDemo: v.is_demo || false,
    })) || []

  return jsonResponse({ videos: videoList })
}
