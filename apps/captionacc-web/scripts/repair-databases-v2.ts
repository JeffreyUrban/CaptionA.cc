#!/usr/bin/env tsx
/**
 * Repair all databases to schema version 2
 *
 * This migrates databases from v1 to v2:
 * - Adds text_review_status table
 * - Adds median_ocr_status, median_ocr_error, median_ocr_processed_at to captions table
 *
 * Usage:
 *   npm run repair-databases-v2
 *   npm run repair-databases-v2 -- --force
 */

import { CURRENT_SCHEMA_VERSION } from '../app/db/migrate'
import { repairAllDatabases } from '../app/services/database-repair-service'

const force = process.argv.includes('--force')

console.log('='.repeat(80))
console.log(`Database Schema Repair - Version ${CURRENT_SCHEMA_VERSION}`)
console.log('='.repeat(80))
console.log()

if (force) {
  console.log('⚠️  FORCE MODE: Will apply destructive changes without confirmation')
  console.log()
}

async function main() {
  console.log(`Repairing all databases to schema version ${CURRENT_SCHEMA_VERSION}...`)
  console.log()

  const result = await repairAllDatabases(CURRENT_SCHEMA_VERSION, force)

  console.log()
  console.log('='.repeat(80))
  console.log('Repair Summary')
  console.log('='.repeat(80))
  console.log(`Total databases: ${result.total}`)
  console.log(`Already current: ${result.current}`)
  console.log(`Repaired: ${result.repaired}`)
  console.log(`Failed: ${result.failed}`)
  console.log(`Need confirmation: ${result.needsConfirmation}`)
  console.log()

  if (result.failed > 0) {
    console.log('❌ Failed databases:')
    const failedDbs = result.results.filter(r => r.status === 'failed')
    for (const db of failedDbs) {
      console.log(`  ${db.path}`)
      console.log(`    Error: ${db.error}`)
    }
    console.log()
  }

  if (result.hasDestructiveChanges && !force) {
    console.log('⚠️  Destructive changes detected but not applied (use --force to apply):')
    console.log()

    if (result.destructiveActionsSummary?.tablesToRemove) {
      console.log('  Tables to remove:')
      for (const [table, info] of Object.entries(result.destructiveActionsSummary.tablesToRemove)) {
        console.log(`    - ${table}: ${info.databases} database(s), ${info.totalRows} total rows`)
      }
      console.log()
    }

    if (result.destructiveActionsSummary?.columnsToRemove) {
      console.log('  Columns to remove:')
      for (const [column, info] of Object.entries(
        result.destructiveActionsSummary.columnsToRemove
      )) {
        console.log(`    - ${column}: ${info.databases} database(s)`)
      }
      console.log()
    }
  }

  if (result.needsConfirmation > 0) {
    console.log('⚠️  Some databases need confirmation for destructive changes')
    console.log('    Run with --force to apply all changes')
    console.log()
  }

  if (result.repaired > 0) {
    console.log('✅ Successfully repaired databases')

    // Show sample of repaired databases
    const repairedDbs = result.results.filter(r => r.status === 'repaired').slice(0, 5)
    if (repairedDbs.length > 0) {
      console.log()
      console.log('Sample of repaired databases (showing first 5):')
      for (const db of repairedDbs) {
        console.log(`  ${db.path}`)
        if (db.actions.length > 0) {
          console.log(`    Actions: ${db.actions.join(', ')}`)
        }
      }
    }
  }

  console.log()
  console.log('='.repeat(80))

  if (result.failed > 0) {
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
