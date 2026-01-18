/**
 * Server-side Supabase client for React Router SSR
 *
 * Uses cookies for session management so server-side loaders can authenticate users.
 */

import { createServerClient } from '@supabase/ssr'

import type { Database } from '~/types/supabase'

const supabaseUrl = process.env['VITE_SUPABASE_URL']!
const supabaseAnonKey = process.env['VITE_SUPABASE_ANON_KEY']!

/**
 * Create a Supabase client for server-side use with cookie access
 *
 * This client can read/write cookies, allowing server-side loaders to authenticate users.
 *
 * @param request - The request object (to read cookies)
 * @param response - The response headers (to set cookies)
 */
export function createSupabaseServerClient(request: Request, responseHeaders: Headers) {
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        const cookies = request.headers.get('Cookie')
        if (!cookies) return []

        return cookies
          .split(';')
          .map(cookie => {
            const [name, ...valueParts] = cookie.trim().split('=')
            return { name: name ?? '', value: valueParts.join('=') ?? '' }
          })
          .filter(cookie => cookie.name && cookie.value)
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          const cookieString = `${name}=${value}; Path=${options?.path ?? '/'}; Max-Age=${options?.maxAge ?? 3600}; SameSite=${options?.sameSite ?? 'Lax'}${options?.secure ? '; Secure' : ''}${options?.httpOnly ? '; HttpOnly' : ''}`
          responseHeaders.append('Set-Cookie', cookieString)
        })
      },
    },
  })
}
