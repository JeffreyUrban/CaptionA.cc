/**
 * API endpoint to check if the current user is a platform admin
 *
 * Note: With localStorage auth, tokens are sent via Authorization header from client
 */

import { createClient } from '@supabase/supabase-js'
import type { LoaderFunctionArgs } from 'react-router'

import { isPlatformAdmin } from '~/services/platform-admin'
import type { Database } from '~/types/supabase'

// Environment variables for Supabase
const supabaseUrl = process.env['VITE_SUPABASE_URL'] || 'http://localhost:54321'
const supabaseAnonKey =
  process.env['VITE_SUPABASE_ANON_KEY'] ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export async function loader({ request }: LoaderFunctionArgs) {
  // Get access token from Authorization header
  const authHeader = request.headers.get('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[is-platform-admin] No Authorization header found')
    return { isPlatformAdmin: false }
  }

  const accessToken = authHeader.replace('Bearer ', '')

  // Create Supabase client with the access token
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    db: {
      schema: 'captionacc_production',
    },
  })

  // Get current user from the access token
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken)

  if (error || !user) {
    console.log('[is-platform-admin] Could not get user:', error?.message)
    return { isPlatformAdmin: false }
  }

  console.log('[is-platform-admin] Checking admin status for user:', user.id)

  // Check if user is platform admin (pass authenticated client for RLS)
  const isAdmin = await isPlatformAdmin(user.id, supabase)

  console.log('[is-platform-admin] Result:', isAdmin)

  return { isPlatformAdmin: isAdmin }
}
