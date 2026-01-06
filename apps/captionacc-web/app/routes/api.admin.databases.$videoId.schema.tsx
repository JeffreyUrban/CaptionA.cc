/**
 * Admin API: Database schema inspection
 *
 * GET /api/admin/databases/:videoId/schema
 * Returns detailed schema information for a specific database
 */

import type { LoaderFunctionArgs } from 'react-router'

import { getDatabaseSchema } from '~/services/database-admin-service'
import {
  badRequestResponse,
  errorResponse,
  jsonResponse,
  notFoundResponse,
} from '~/utils/api-responses'

export async function loader({ params, request }: LoaderFunctionArgs) {
  try {
    // Require platform admin access
    const { requirePlatformAdmin } = await import('~/services/platform-admin')
    await requirePlatformAdmin(request)

    const { videoId } = params

    if (!videoId) {
      return badRequestResponse('Video ID required')
    }

    const schema = getDatabaseSchema(videoId)
    return jsonResponse(schema)
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return notFoundResponse(error.message)
    }

    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(`Failed to get database schema: ${message}`, 500)
  }
}
