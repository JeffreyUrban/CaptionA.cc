/**
 * Supabase Client for CaptionA.cc Web App
 *
 * Provides authenticated access to Supabase for:
 * - User authentication
 * - Video cataloging in multi-tenant environment
 * - Training cohort management
 * - Cross-video search
 */

import { createClient } from '@supabase/supabase-js'

import type { Session } from '@supabase/supabase-js'
import type { Database } from '../types/supabase'

// Environment variables - use import.meta.env for Vite
// Fallback to local Supabase defaults for development
const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'] || 'http://localhost:54321'
const supabaseAnonKey =
  import.meta.env['VITE_SUPABASE_ANON_KEY'] ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

/**
 * Create a Supabase client for use in client-side code
 * Uses the anon key which respects RLS policies
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Create a Supabase client for server-side operations
 * Uses the service role key which bypasses RLS (use carefully)
 * Only available on the server
 */
export function createServerSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error('Server-side Supabase client should not be used in the browser')
  }

  const serviceRoleKey =
    import.meta.env['VITE_SUPABASE_SERVICE_ROLE_KEY'] ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    console.error('Error fetching current user:', error)
    return null
  }

  return user
}

/**
 * Get the user's tenant ID from their profile
 */
export async function getUserTenantId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single<Database['public']['Tables']['user_profiles']['Row']>()

  if (error) {
    console.error('Error fetching user tenant:', error)
    return null
  }

  return data?.tenant_id ?? null
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw new Error(`Sign in failed: ${error.message}`)
  }

  return data
}

/**
 * Sign up with email and password
 */
export async function signUp(email: string, password: string, metadata?: { full_name?: string }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
    },
  })

  if (error) {
    throw new Error(`Sign up failed: ${error.message}`)
  }

  return data
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw new Error(`Sign out failed: ${error.message}`)
  }
}

/**
 * Subscribe to authentication state changes
 */
export function onAuthStateChange(callback: (event: string, session: Session | null) => void) {
  return supabase.auth.onAuthStateChange(callback)
}
