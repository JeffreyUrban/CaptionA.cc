/**
 * Feature Access Control
 *
 * Utilities for checking and enforcing feature access based on user access tiers.
 * Access tiers are defined in the database and control which features users can access.
 */

import { redirect } from 'react-router'

import { createServerSupabaseClient } from '~/services/supabase-client'

export type Feature = 'annotation' | 'export' | 'upload'

/**
 * Check if user has access to a feature
 * @param userId - User ID to check
 * @param feature - Feature to check access for
 * @returns true if user has access, false otherwise
 */
export async function requireFeature(userId: string, feature: Feature): Promise<boolean> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase.rpc('has_feature_access', {
    p_user_id: userId,
    p_feature: feature,
  })

  if (error) {
    console.error('Feature check error:', error)
    return false
  }

  return data as boolean
}

/**
 * Middleware: require feature access or throw 402
 * Use this in route loaders/actions to enforce feature access
 *
 * @param request - Request object
 * @param feature - Feature to require access for
 * @returns User ID if access granted
 * @throws Response 401 if not authenticated
 * @throws Response 402 if feature access denied
 */
export async function requireFeatureMiddleware(
  request: Request,
  feature: Feature
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw redirect('/login')
  }

  const hasAccess = await requireFeature(user.id, feature)

  if (!hasAccess) {
    throw new Response('Access Upgrade Required', {
      status: 402,
      headers: { 'X-Required-Feature': feature },
    })
  }

  return user.id
}
