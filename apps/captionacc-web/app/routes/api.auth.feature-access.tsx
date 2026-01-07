/**
 * Feature Access API
 *
 * Endpoint for checking feature access from client-side code.
 * Used by useFeatureAccess hook for UX (not security).
 */

import type { LoaderFunctionArgs } from 'react-router'

import { createServerSupabaseClient } from '~/services/supabase-client'
import { badRequestResponse, jsonResponse } from '~/utils/api-responses'
import { requireFeature } from '~/utils/feature-auth'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const feature = url.searchParams.get('feature')

  if (!feature) {
    return badRequestResponse('Missing feature parameter')
  }

  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonResponse({ hasAccess: false })
  }

  const hasAccess = await requireFeature(user.id, feature as 'annotation' | 'export' | 'upload')
  return jsonResponse({ hasAccess })
}
