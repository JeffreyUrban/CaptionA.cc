/**
 * Platform Admin Authorization Service
 *
 * Handles platform admin access control for administrative routes and operations.
 * Platform admins have cross-tenant access for system administration.
 */

import { redirect } from 'react-router'

import { createServerSupabaseClient } from './supabase-client'

/**
 * Check if a user is a platform admin
 *
 * @param userId - User UUID to check
 * @returns true if user is an active platform admin
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id, admin_level, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .single()

  if (error || !data) {
    return false
  }

  return true
}

/**
 * Require platform admin access for a route
 *
 * Call this in route loaders to protect admin routes.
 * Throws a redirect to /auth/login if not authenticated or not a platform admin.
 *
 * @param request - The request object from the loader
 * @returns The authenticated user ID if platform admin
 * @throws Redirect to login if not authenticated or not admin
 *
 * @example
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   await requirePlatformAdmin(request)
 *   // ... rest of loader logic
 * }
 */
export async function requirePlatformAdmin(request: Request): Promise<string> {
  const supabase = createServerSupabaseClient()

  // Get session from request headers
  // In React Router / Remix, the auth cookie is passed in the request
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    // Not authenticated - redirect to login
    throw redirect('/auth/login?redirectTo=/admin')
  }

  // Check if user is platform admin
  const isAdmin = await isPlatformAdmin(user.id)

  if (!isAdmin) {
    // Authenticated but not admin - return 403
    throw new Response('Forbidden: Platform admin access required', { status: 403 })
  }

  return user.id
}

/**
 * Get platform admin level for a user
 *
 * @param userId - User UUID
 * @returns admin_level ('super_admin' | 'support') or null if not admin
 */
export async function getPlatformAdminLevel(
  userId: string
): Promise<'super_admin' | 'support' | null> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .from('platform_admins')
    .select('admin_level')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .single()

  if (error || !data) {
    return null
  }

  // Type assertion needed until Database types are regenerated
  return (data as { admin_level: 'super_admin' | 'support' }).admin_level
}

/**
 * Check if current user (client-side) is platform admin
 *
 * This should only be used for UI display logic.
 * Real authorization must happen server-side.
 *
 * @returns true if current client-side user is platform admin
 */
export async function checkPlatformAdminClient(): Promise<boolean> {
  try {
    // Call a server endpoint to check
    const response = await fetch('/api/auth/is-platform-admin')
    if (!response.ok) return false

    const data = await response.json()
    return data.isPlatformAdmin === true
  } catch {
    return false
  }
}
