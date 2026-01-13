/**
 * API endpoint to check if the current user is a platform admin
 *
 * In SPA mode, the shared supabase client has the user's session
 */

import type { LoaderFunctionArgs } from 'react-router'

import { isPlatformAdmin } from '~/services/platform-admin'
import { supabase } from '~/services/supabase-client'

export async function loader({ request }: LoaderFunctionArgs) {
  // Get current user from the shared client (has session in SPA mode)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    console.log('[is-platform-admin] No authenticated user')
    return { isPlatformAdmin: false }
  }

  console.log('[is-platform-admin] Checking admin status for user:', user.id)

  // Check if user is platform admin (shared client has auth context)
  const isAdmin = await isPlatformAdmin(user.id)

  console.log('[is-platform-admin] Result:', isAdmin)

  return { isPlatformAdmin: isAdmin }
}
