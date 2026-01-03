/**
 * Admin API: Database status summary
 *
 * GET /api/admin/databases/status
 * Returns version distribution and health summary across all databases
 */

import { getDatabaseStatusSummary } from '~/services/database-admin-service'
import { errorResponse, jsonResponse } from '~/utils/api-responses'

export async function loader() {
  try {
    const summary = getDatabaseStatusSummary()
    return jsonResponse(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(`Failed to get database status: ${message}`, 500)
  }
}
