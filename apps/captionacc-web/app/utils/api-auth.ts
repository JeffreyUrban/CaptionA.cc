/**
 * API Authentication & Authorization Middleware
 *
 * Provides centralized authentication and authorization for API routes.
 * Implements defense-in-depth security with RLS as the ultimate enforcer.
 *
 * Security monitoring: Logs all auth failures and cross-tenant access attempts
 * to security_audit_log table for detection and alerting.
 */

import type { User } from '@supabase/supabase-js'

import { isPlatformAdmin } from '~/services/platform-admin'
import {
  logAuthFailure,
  logAuthSuccess,
  logAuthzFailure,
  logCrossTenantAttempt,
} from '~/services/security-audit.server'
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
 * Security: Logs authentication failures and successes to audit log
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
    // Log authentication failure
    await logAuthFailure(request, error?.message ?? 'No user session')
    throw new Response('Unauthorized', { status: 401 })
  }

  // Get user profile (includes tenant_id, role, approval_status)
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('tenant_id, role, approval_status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    // Log authentication failure (profile missing)
    await logAuthFailure(request, `User profile not found for ${user.id}`)
    throw new Response('User profile not found', { status: 404 })
  }

  // Check approval status
  if (profile.approval_status !== 'approved') {
    // Log authentication failure (not approved)
    await logAuthFailure(request, `Account pending approval for ${user.id}`)
    throw new Response('Account pending approval', { status: 403 })
  }

  // Validate required profile fields
  if (!profile.tenant_id || !profile.role) {
    await logAuthFailure(request, `Incomplete user profile for ${user.id}`)
    throw new Response('Incomplete user profile', { status: 500 })
  }

  // Check if platform admin
  const isAdmin = await isPlatformAdmin(user.id)

  // Log successful authentication
  await logAuthSuccess(request, user.id, profile.tenant_id)

  return {
    user,
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role as 'owner' | 'member',
    isPlatformAdmin: isAdmin,
  }
}

/**
 * Require video ownership for modification
 * Platform admins and tenant owners bypass this check
 *
 * Security: Logs authorization failures and CRITICAL cross-tenant access attempts
 *
 * @param authContext - Auth context from requireAuth()
 * @param videoId - Video ID to check ownership for
 * @param request - Request object for audit logging
 * @throws Response 404 if video not found
 * @throws Response 403 if user doesn't own the video
 */
export async function requireVideoOwnership(
  authContext: AuthContext,
  videoId: string,
  request?: Request
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
    // CRITICAL: Check if this is a cross-tenant access attempt
    if (video.tenant_id && video.tenant_id !== authContext.tenantId && request) {
      // Log cross-tenant access attempt (CRITICAL security event)
      await logCrossTenantAttempt(
        request,
        authContext.userId,
        authContext.tenantId,
        video.tenant_id,
        'video',
        videoId,
        {
          video_owner: video.uploaded_by_user_id,
          user_role: authContext.role,
          is_same_tenant: video.tenant_id === authContext.tenantId,
        }
      )
    } else if (request) {
      // Log regular authorization failure (same tenant, but not owner)
      await logAuthzFailure(
        request,
        authContext.userId,
        authContext.tenantId,
        'video',
        videoId,
        'User does not own this video'
      )
    }

    throw new Response('Forbidden: Not your video', { status: 403 })
  }
}
