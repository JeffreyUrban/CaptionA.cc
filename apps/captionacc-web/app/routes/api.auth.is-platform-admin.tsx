/**
 * API endpoint to check if the current user is a platform admin
 */

import type { LoaderFunctionArgs } from 'react-router'
import { createClient } from '@supabase/supabase-js'

import type { Database } from '~/types/supabase'
import { isPlatformAdmin } from '~/services/platform-admin'

// Environment variables for Supabase
const supabaseUrl = process.env['VITE_SUPABASE_URL'] || 'http://localhost:54321'
const supabaseAnonKey =
  process.env['VITE_SUPABASE_ANON_KEY'] ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

function getAccessTokenFromCookies(cookies: string): string | null {
  // Parse cookies to find the Supabase auth token
  // Supabase stores tokens in cookies like: sb-<project-ref>-auth-token
  const cookiePairs = cookies.split(';').map(c => c.trim())

  console.log('[is-platform-admin] Cookie pairs found:', cookiePairs.length)
  console.log('[is-platform-admin] Looking for auth token in cookies...')

  for (const pair of cookiePairs) {
    const [name, ...rest] = pair.split('=')
    const value = rest.join('=') // Rejoin in case value contains '='

    console.log('[is-platform-admin] Cookie name:', name)

    // Look for Supabase auth token cookie
    if (name && name.includes('sb-') && name.includes('-auth-token')) {
      console.log('[is-platform-admin] Found potential auth cookie:', name)
      try {
        // The cookie value is URL-encoded JSON with base64 data
        const decoded = decodeURIComponent(value)
        const data = JSON.parse(decoded)
        console.log(
          '[is-platform-admin] Parsed cookie data, has access_token:',
          !!data.access_token
        )
        return data.access_token || null
      } catch (e) {
        console.log('[is-platform-admin] Failed to parse cookie:', e)
        continue
      }
    }
  }

  console.log('[is-platform-admin] No Supabase auth token cookie found')
  return null
}

export async function loader({ request }: LoaderFunctionArgs) {
  const cookies = request.headers.get('Cookie') || ''
  const accessToken = getAccessTokenFromCookies(cookies)

  if (!accessToken) {
    console.log('[is-platform-admin] No access token found in cookies')
    return { isPlatformAdmin: false }
  }

  // Create Supabase client and set the session with the access token
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

  // Check if user is platform admin
  const isAdmin = await isPlatformAdmin(user.id)

  console.log('[is-platform-admin] Result:', isAdmin)

  return { isPlatformAdmin: isAdmin }
}
