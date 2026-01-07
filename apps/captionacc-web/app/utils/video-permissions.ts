/**
 * Video Permissions
 *
 * Granular permission checks for video operations.
 * Handles demo videos, trial tier annotation limits, and ownership rules.
 */

import { redirect } from 'react-router'

import { isPlatformAdmin } from '~/services/platform-admin'
import { createServerSupabaseClient } from '~/services/supabase-client'

export interface VideoPermissions {
  canView: boolean
  canAnnotate: boolean
  canDelete: boolean
  canExport: boolean
  isDemo: boolean
  reason?: string
}

/**
 * Get permissions for a specific video
 * Handles demo videos, trial tier limits, and ownership
 *
 * @param userId - User ID to check permissions for
 * @param videoId - Video ID to check
 * @returns VideoPermissions object
 */
export async function getVideoPermissions(
  userId: string,
  videoId: string
): Promise<VideoPermissions> {
  const supabase = createServerSupabaseClient()

  // Get video details
  const { data: video, error } = await supabase
    .from('videos')
    .select('is_demo, uploaded_by_user_id, tenant_id')
    .eq('id', videoId)
    .single()

  if (!video || error) {
    return {
      canView: false,
      canAnnotate: false,
      canDelete: false,
      canExport: false,
      isDemo: false,
      reason: 'Video not found',
    }
  }

  // Demo videos: read-only for everyone
  if (video.is_demo) {
    return {
      canView: true,
      canAnnotate: false,
      canDelete: false,
      canExport: false,
      isDemo: true,
      reason: 'Demo videos are read-only',
    }
  }

  // Check ownership (owner, tenant owner, or platform admin)
  const isOwner = video.uploaded_by_user_id === userId
  const isAdmin = await isPlatformAdmin(userId)
  // Note: Tenant owner check can be added here when multi-user tenants are enabled

  const canView = isOwner || isAdmin
  const canExport = isOwner || isAdmin
  const canDelete = isOwner || isAdmin

  // Annotation permission depends on access tier
  let canAnnotate = false
  if (isOwner) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('access_tier_id')
      .eq('id', userId)
      .single()

    if (profile?.access_tier_id === 'trial') {
      // Trial tier: only first 3 uploaded videos (including deleted in count)
      const { data: allUserVideos } = await supabase
        .from('videos')
        .select('id, deleted_at')
        .eq('uploaded_by_user_id', userId)
        .order('uploaded_at', { ascending: true })
        .limit(3)

      const isInFirstThree = allUserVideos?.some(v => v.id === videoId)
      const { data: currentVideo } = await supabase
        .from('videos')
        .select('deleted_at')
        .eq('id', videoId)
        .single()

      canAnnotate = !!isInFirstThree && !currentVideo?.deleted_at
    } else if (profile?.access_tier_id === 'active') {
      canAnnotate = true
    }
  } else if (isAdmin) {
    canAnnotate = true
  }

  return {
    canView,
    canAnnotate,
    canDelete,
    canExport,
    isDemo: false,
    reason:
      !canAnnotate && canView
        ? 'Annotation limited to first 3 uploaded videos on trial tier'
        : undefined,
  }
}

/**
 * Middleware: require annotation permission
 * Use in annotation route loaders to enforce permissions
 *
 * @param request - Request object
 * @param videoId - Video ID to check
 * @throws Response 401 if not authenticated
 * @throws Response 403 if annotation not allowed
 */
export async function requireAnnotatePermission(request: Request, videoId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw redirect('/auth/login')
  }

  const permissions = await getVideoPermissions(user.id, videoId)

  if (!permissions.canAnnotate) {
    throw new Response('Forbidden: Cannot annotate this video', {
      status: 403,
      headers: { 'X-Reason': permissions.reason || 'Read-only' },
    })
  }
}
