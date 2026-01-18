/**
 * Supabase Client for CaptionA.cc Web App
 *
 * Provides authenticated access to Supabase for:
 * - User authentication
 * - Video cataloging in multi-tenant environment
 * - Training cohort management
 * - Cross-video search
 */

import { createClient, type Session } from '@supabase/supabase-js'

import type { Database } from '../types/supabase'

// Type alias for production database using captionacc_production schema
// We merge Functions from both captionacc_production and public schemas
// since security audit functions are defined in public schema
type ProductionDatabase = {
  public: {
    Tables: Database['captionacc_production']['Tables']
    Views: Database['captionacc_production']['Views']
    Functions: Database['captionacc_production']['Functions'] & Database['public']['Functions']
    Enums: Database['captionacc_production']['Enums']
    CompositeTypes: Database['captionacc_production']['CompositeTypes']
  }
}

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']!
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY']!
const supabaseSchema = import.meta.env['VITE_SUPABASE_SCHEMA']!

// Log Supabase connection info in development
if (import.meta.env.DEV) {
  console.log(
    `🔌 Supabase: ONLINE (${supabaseUrl}) [schema: ${supabaseSchema}]`
  )
}

/**
 * Create a Supabase client for use in client-side code
 * Uses the anon key which respects RLS policies
 * Both local and remote use captionacc_production schema
 */
export const supabase = createClient<ProductionDatabase>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  db: {
    schema: supabaseSchema, // Set PostgreSQL schema
  },
})

/**
 * Create a Supabase client for server-side operations
 * Uses the service role key which bypasses RLS (use carefully)
 * Only available on the server
 * Both local and remote use captionacc_production schema
 */
export function createServerSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error('Server-side Supabase client should not be used in the browser')
  }

  const serviceRoleKey = import.meta.env['VITE_SUPABASE_SERVICE_ROLE_KEY']!

  return createClient<ProductionDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: supabaseSchema, // Set PostgreSQL schema (same as client)
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
  const { data, error } = await supabase.from('user_profiles').select('*').eq('id', userId).single()

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
