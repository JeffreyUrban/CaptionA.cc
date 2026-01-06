/**
 * Admin API: Database list with filters
 *
 * GET /api/admin/databases/list?version=1&status=current&search=video
 * Returns detailed list of databases with optional filtering
 */

import type { LoaderFunctionArgs } from 'react-router'

import { getDatabaseDetailedStatus, type DatabaseInfo } from '~/services/database-admin-service'
import { errorResponse, jsonResponse } from '~/utils/api-responses'

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Require platform admin access
    const { requirePlatformAdmin } = await import('~/services/platform-admin')
    await requirePlatformAdmin(request)

    const url = new URL(request.url)
    const filters: {
      version?: number
      status?: DatabaseInfo['status']
      search?: string
    } = {}

    // Parse query parameters
    const versionParam = url.searchParams.get('version')
    if (versionParam !== null) {
      filters.version = parseInt(versionParam, 10)
    }

    const statusParam = url.searchParams.get('status')
    if (statusParam && isValidStatus(statusParam)) {
      filters.status = statusParam
    }

    const searchParam = url.searchParams.get('search')
    if (searchParam) {
      filters.search = searchParam
    }

    const result = getDatabaseDetailedStatus(filters)
    return jsonResponse(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(`Failed to get database list: ${message}`, 500)
  }
}

function isValidStatus(status: string): status is DatabaseInfo['status'] {
  return ['current', 'outdated', 'incomplete', 'unversioned'].includes(status)
}
