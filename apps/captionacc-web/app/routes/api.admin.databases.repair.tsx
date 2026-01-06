/**
 * API endpoint for repairing all databases to target schema version
 */

import type { ActionFunction } from 'react-router'

import { CURRENT_SCHEMA_VERSION, LATEST_SCHEMA_VERSION } from '~/db/migrate'
import { repairAllDatabases } from '~/services/database-repair-service'

export const action: ActionFunction = async ({ request }) => {
  try {
    // Require platform admin access
    const { requirePlatformAdmin } = await import('~/services/platform-admin')
    await requirePlatformAdmin(request)

    const body = await request.json()
    const targetVersion = body.targetVersion ?? CURRENT_SCHEMA_VERSION
    const force = body.force ?? false

    console.log('[RepairAPI] Starting repair:', { targetVersion, force })

    // Validate target version
    // Support: latest (unreleased), current, and previous version
    const minVersion = Math.max(0, CURRENT_SCHEMA_VERSION - 1)
    const validVersions = [
      LATEST_SCHEMA_VERSION, // Latest unreleased
      CURRENT_SCHEMA_VERSION, // Current release
      minVersion, // Previous release (if different from current)
    ]

    if (!validVersions.includes(targetVersion)) {
      return Response.json(
        {
          error: `Invalid target version. Supported: latest (${LATEST_SCHEMA_VERSION}), v${CURRENT_SCHEMA_VERSION}, v${minVersion}`,
        },
        { status: 400 }
      )
    }

    const result = await repairAllDatabases(targetVersion, force)

    console.log('[RepairAPI] Repair complete:', {
      total: result.total,
      repaired: result.repaired,
      failed: result.failed,
      needsConfirmation: result.needsConfirmation,
      hasDestructiveChanges: result.hasDestructiveChanges,
    })

    // Log first few failed databases for debugging
    const failedDbs = result.results.filter(r => r.status === 'failed').slice(0, 3)
    if (failedDbs.length > 0) {
      console.log('[RepairAPI] First failed databases:')
      for (const db of failedDbs) {
        console.log(`  ${db.path}: ${db.error}`)
        console.log(`    Actions: ${db.actions.join(', ')}`)
        console.log(`    Destructive: ${db.destructiveActions.join(', ')}`)
      }
    }

    return Response.json(result)
  } catch (error) {
    console.error('Database repair failed:', error)
    return Response.json(
      { error: 'Failed to repair databases', details: String(error) },
      { status: 500 }
    )
  }
}
