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

// Type alias for production database using captionacc_prod schema
// We merge Functions from both captionacc_prod and public schemas
// since security audit functions are defined in public schema
type ProductionDatabase = {
  public: {
    Tables: Database['captionacc_prod']['Tables']
    Views: Database['captionacc_prod']['Views']
    Functions: Database['captionacc_prod']['Functions'] & Database['public']['Functions']
    Enums: Database['captionacc_prod']['Enums']
    CompositeTypes: Database['captionacc_prod']['CompositeTypes']
  }
}

// Environment variables are required at runtime - set via fly.toml build args
// Separate Supabase projects for prod and dev provide isolation
// During CI builds, these may be empty - the client will be created lazily
const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'] ?? ''
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] ?? ''

// Schema is 'captionacc' in both prod and dev Supabase projects
const supabaseSchema = import.meta.env['VITE_SUPABASE_SCHEMA'] ?? 'captionacc'

// Log Supabase connection info in development
if (import.meta.env.DEV && supabaseUrl) {
  console.log(`🔌 Supabase: ONLINE (${supabaseUrl}) [schema: ${supabaseSchema}]`)
}

// Lazy initialization to support CI builds where env vars may not be set
let _supabase: ReturnType<typeof createClient<ProductionDatabase>> | null = null

/**
 * Get the Supabase client (lazily initialized)
 * Throws if VITE_SUPABASE_URL is not configured
 */
function getSupabaseClient(): ReturnType<typeof createClient<ProductionDatabase>> {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase configuration missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.'
      )
    }
    _supabase = createClient<ProductionDatabase>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      db: {
        schema: supabaseSchema, // Set PostgreSQL schema
      },
    })
  }
  return _supabase
}

/**
 * Supabase client for use in client-side code
 * Uses the anon key which respects RLS policies
 * Note: This is a getter that lazily initializes the client
 */
export const supabase = new Proxy({} as ReturnType<typeof createClient<ProductionDatabase>>, {
  get(_, prop) {
    return (getSupabaseClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

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
