/**
 * API Authentication & Authorization Middleware
 *
 * Provides centralized authentication and authorization for API routes.
 * Implements defense-in-depth security with RLS as the ultimate enforcer.
 */

import type { User } from '@supabase/supabase-js'

import { isPlatformAdmin } from '~/services/platform-admin'
import { createServerSupabaseClient } from '~/services/supabase-client'

export interface AuthContext {
  user: User
  userId: string
  tenantId: string
  role: 'owner' | 'member'
  isPlatformAdmin: boolean
}

/**
 * Authenticate request and return user context
 * Use this in ALL API route loaders/actions that require authentication
 *
 * @param request - Request object
 * @returns AuthContext with user information
 * @throws Response 401 if not authenticated
 * @throws Response 403 if account pending approval
 * @throws Response 404 if user profile not found
 */
export async function requireAuth(request: Request): Promise<AuthContext> {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Response('Unauthorized', { status: 401 })
  }

  // Get user profile (includes tenant_id, role, approval_status)
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('tenant_id, role, approval_status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new Response('User profile not found', { status: 404 })
  }

  // Check approval status
  if (profile.approval_status !== 'approved') {
    throw new Response('Account pending approval', { status: 403 })
  }

  // Check if platform admin
  const isAdmin = await isPlatformAdmin(user.id)

  return {
    user,
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
    isPlatformAdmin: isAdmin,
  }
}

/**
 * Require video ownership for modification
 * Platform admins and tenant owners bypass this check
 *
 * @param authContext - Auth context from requireAuth()
 * @param videoId - Video ID to check ownership for
 * @throws Response 404 if video not found
 * @throws Response 403 if user doesn't own the video
 */
export async function requireVideoOwnership(
  authContext: AuthContext,
  videoId: string
): Promise<void> {
  // Platform admins bypass ownership checks
  if (authContext.isPlatformAdmin) {
    return
  }

  const supabase = createServerSupabaseClient()

  const { data: video, error } = await supabase
    .from('videos')
    .select('uploaded_by_user_id, tenant_id')
    .eq('id', videoId)
    .single()

  if (error || !video) {
    throw new Response('Video not found', { status: 404 })
  }

  // Check ownership: either uploaded by user OR user is tenant owner
  const isOwner = video.uploaded_by_user_id === authContext.userId
  const isTenantOwner = authContext.role === 'owner' && video.tenant_id === authContext.tenantId

  if (!isOwner && !isTenantOwner) {
    throw new Response('Forbidden: Not your video', { status: 403 })
  }
}
