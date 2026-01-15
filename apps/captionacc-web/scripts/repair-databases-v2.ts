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
import { repairAllDatabases, type RepairSummary } from '../app/services/database-repair-service'

// Infer RepairResult type from RepairSummary
type RepairResult = RepairSummary['results'][number]

const force = process.argv.includes('--force')

console.log('='.repeat(80))
console.log(`Database Schema Repair - Version ${CURRENT_SCHEMA_VERSION}`)
console.log('='.repeat(80))
console.log()

if (force) {
  console.log('Warning: FORCE MODE: Will apply destructive changes without confirmation')
  console.log()
}

/**
 * Print summary statistics for the repair operation
 */
function printSummary(result: RepairSummary): void {
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
}

/**
 * Print details about failed databases
 */
function printFailedDatabases(results: RepairResult[]): void {
  const failedDbs = results.filter(r => r.status === 'failed')
  if (failedDbs.length === 0) return

  console.log('Failed databases:')
  for (const db of failedDbs) {
    console.log(`  ${db.path}`)
    console.log(`    Error: ${db.error}`)
  }
  console.log()
}

/**
 * Print details about destructive changes that were not applied
 */
function printDestructiveChanges(result: RepairSummary): void {
  if (!result.hasDestructiveChanges || force) return

  console.log('Warning: Destructive changes detected but not applied (use --force to apply):')
  console.log()

  const summary = result.destructiveActionsSummary
  if (summary?.tablesToRemove) {
    console.log('  Tables to remove:')
    for (const [table, info] of Object.entries(summary.tablesToRemove)) {
      console.log(`    - ${table}: ${info.databases} database(s), ${info.totalRows} total rows`)
    }
    console.log()
  }

  if (summary?.columnsToRemove) {
    console.log('  Columns to remove:')
    for (const [column, info] of Object.entries(summary.columnsToRemove)) {
      console.log(`    - ${column}: ${info.databases} database(s)`)
    }
    console.log()
  }
}

/**
 * Print details about successfully repaired databases
 */
function printRepairedDatabases(results: RepairResult[]): void {
  const repairedDbs = results.filter(r => r.status === 'repaired')
  if (repairedDbs.length === 0) return

  console.log('Successfully repaired databases')

  // Show sample of repaired databases (first 5)
  const sample = repairedDbs.slice(0, 5)
  if (sample.length > 0) {
    console.log()
    console.log('Sample of repaired databases (showing first 5):')
    for (const db of sample) {
      console.log(`  ${db.path}`)
      if (db.actions.length > 0) {
        console.log(`    Actions: ${db.actions.join(', ')}`)
      }
    }
  }
}

async function main() {
  console.log(`Repairing all databases to schema version ${CURRENT_SCHEMA_VERSION}...`)
  console.log()

  const result = await repairAllDatabases(CURRENT_SCHEMA_VERSION, force)

  printSummary(result)
  printFailedDatabases(result.results)
  printDestructiveChanges(result)

  if (result.needsConfirmation > 0) {
    console.log('Warning: Some databases need confirmation for destructive changes')
    console.log('    Run with --force to apply all changes')
    console.log()
  }

  if (result.repaired > 0) {
    printRepairedDatabases(result.results)
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
