/**
 * Platform Admin Authorization Service
 *
 * Handles platform admin access control for administrative routes and operations.
 * Platform admins have cross-tenant access for system administration.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { supabase } from './supabase-client'
import type { Database } from '~/types/supabase'

/**
 * Check if a user is a platform admin
 *
 * @param userId - User UUID to check
 * @param client - Optional authenticated Supabase client (required for RLS to work)
 * @returns true if user is an active platform admin
 */
export async function isPlatformAdmin(userId: string, client?: SupabaseClient): Promise<boolean> {
  const db = client || supabase

  const { data, error } = await db
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
 * Require platform admin access for API routes
 *
 * Call this in API route loaders to protect admin endpoints.
 * Expects Authorization header with Bearer token.
 * Throws appropriate error responses if not authenticated or not a platform admin.
 *
 * @param request - The request object from the loader
 * @returns The authenticated user ID if platform admin
 * @throws Response with error status if not authenticated or not admin
 *
 * @example
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const userId = await requirePlatformAdmin(request)
 *   // ... rest of loader logic
 * }
 */
export async function requirePlatformAdmin(request: Request): Promise<string> {
  // Get access token from Authorization header
  const authHeader = request.headers.get('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Response('Unauthorized: Missing or invalid authorization', { status: 401 })
  }

  const accessToken = authHeader.replace('Bearer ', '')

  // Create Supabase client with access token
  const { createClient } = await import('@supabase/supabase-js')
  const supabaseUrl = process.env['VITE_SUPABASE_URL'] || 'http://localhost:54321'
  const supabaseAnonKey =
    process.env['VITE_SUPABASE_ANON_KEY'] ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

  const supabaseWithToken = createClient<Database, 'captionacc_production'>(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      db: { schema: 'captionacc_production' },
    }
  )

  // Get user from access token
  const {
    data: { user },
    error,
  } = await supabaseWithToken.auth.getUser(accessToken)

  if (error || !user) {
    throw new Response('Unauthorized: Invalid token', { status: 401 })
  }

  // Check if user is platform admin (pass authenticated client for RLS)
  const isAdmin = await isPlatformAdmin(user.id, supabaseWithToken)

  if (!isAdmin) {
    throw new Response('Forbidden: Platform admin access required', { status: 403 })
  }

  return user.id
}

/**
 * Get platform admin level for a user
 *
 * @param userId - User UUID
 * @param client - Optional authenticated Supabase client (required for RLS to work)
 * @returns admin_level ('super_admin' | 'support') or null if not admin
 */
export async function getPlatformAdminLevel(
  userId: string,
  client?: SupabaseClient
): Promise<'super_admin' | 'support' | null> {
  const db = client || supabase

  const { data, error } = await db
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
