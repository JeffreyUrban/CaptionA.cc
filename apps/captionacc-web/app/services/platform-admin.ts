/**
 * Platform Admin Authorization Service
 *
 * Handles platform admin access control for administrative routes and operations.
 * Platform admins have cross-tenant access for system administration.
 */

import { supabase } from './supabase-client'

/**
 * Check if a user is a platform admin
 *
 * @param userId - User UUID to check
 * @returns true if user is an active platform admin
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('platform_admins')
    .select('user_id, admin_level')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    console.log('[isPlatformAdmin] Query error:', error.message)
    return false
  }

  return data !== null
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
  const { data, error } = await supabase
    .from('platform_admins')
    .select('admin_level')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return (data as { admin_level: 'super_admin' | 'support' }).admin_level
}

/**
 * Check if the current user is a platform admin
 * Convenience function that gets the current user and checks their admin status
 */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return false
  }

  return isPlatformAdmin(user.id)
}
