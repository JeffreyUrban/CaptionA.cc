/**
 * Database repair and validation
 *
 * Brings incomplete or corrupted databases up to current schema.
 * Idempotent - safe to run multiple times.
 *
 * Philosophy:
 * - Development flexibility: repair rather than reject
 * - Partial recovery better than total loss
 * - Report deviations from standard schema
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'

import { CURRENT_SCHEMA_VERSION } from '../app/db/migrate'

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LOCAL_DATA_DIR = join(__dirname, '../../../local/data')
const SCHEMA_PATH = join(__dirname, '../app/db/annotations-schema.sql')

interface RepairResult {
  path: string
  status: 'current' | 'repaired' | 'failed'
  actions: string[]
  error?: string
}

/**
 * Get expected tables from schema file
 */
function getExpectedTables(schemaSQL: string): Set<string> {
  const tables = new Set<string>()
  const regex = /CREATE TABLE IF NOT EXISTS (\w+)/g
  let match

  while ((match = regex.exec(schemaSQL)) !== null) {
    if (match[1]) {
      tables.add(match[1])
    }
  }

  return tables
}

/**
 * Get actual tables in database
 */
function getActualTables(db: Database.Database): Set<string> {
  const tables = db
    .prepare(
      `
    SELECT name FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `
    )
    .all() as Array<{ name: string }>

  return new Set(tables.map(t => t.name))
}

/**
 * Repair a single database
 */
function repairDatabase(dbPath: string, schemaSQL: string): RepairResult {
  const result: RepairResult = {
    path: dbPath.replace(LOCAL_DATA_DIR + '/', ''),
    status: 'current',
    actions: [],
  }

  let db: Database.Database | null = null

  try {
    db = new Database(dbPath)
    const expectedTables = getExpectedTables(schemaSQL)
    const actualTables = getActualTables(db)

    // Find missing tables
    const missingTables = [...expectedTables].filter(t => !actualTables.has(t))

    if (missingTables.length === 0) {
      // All tables present - verify version
      try {
        const metadata = db.prepare('SELECT schema_version FROM database_metadata').get() as
          | { schema_version: number }
          | undefined

        if (!metadata) {
          result.actions.push('Missing version metadata')
          result.status = 'repaired'
        } else if (metadata.schema_version !== CURRENT_SCHEMA_VERSION) {
          result.actions.push(
            `Version mismatch: ${metadata.schema_version} → ${CURRENT_SCHEMA_VERSION}`
          )
          result.status = 'repaired'
        }
      } catch {
        result.actions.push('Could not read version metadata')
        result.status = 'repaired'
      }
    } else {
      // Missing tables - apply full schema
      result.actions.push(`Missing tables: ${missingTables.join(', ')}`)
      result.status = 'repaired'

      // Apply schema (CREATE TABLE IF NOT EXISTS is idempotent)
      db.exec(schemaSQL)

      result.actions.push('Applied full schema')
    }

    // If we made changes, ensure version is set correctly
    if (result.status === 'repaired') {
      const hasMetadata = actualTables.has('database_metadata')

      if (!hasMetadata) {
        // Metadata table was just created, needs initialization
        db.prepare(
          `
          INSERT INTO database_metadata (
            schema_version,
            created_at,
            verified_at
          ) VALUES (?, datetime('now'), datetime('now'))
        `
        ).run(CURRENT_SCHEMA_VERSION)
        result.actions.push(`Set version to ${CURRENT_SCHEMA_VERSION}`)
      } else {
        // Update existing metadata
        db.prepare(
          `
          UPDATE database_metadata
          SET schema_version = ?,
              verified_at = datetime('now')
          WHERE id = 1
        `
        ).run(CURRENT_SCHEMA_VERSION)
        result.actions.push(`Updated version to ${CURRENT_SCHEMA_VERSION}`)
      }
    }
  } catch (error) {
    result.status = 'failed'
    result.error = String(error)
  } finally {
    if (db) {
      db.close()
    }
  }

  return result
}

/**
 * Find all annotations.db files recursively
 */
function findAllDatabases(): string[] {
  const databases: string[] = []

  function scanDir(dir: string) {
    try {
      const entries = readdirSync(dir)

      for (const entry of entries) {
        const fullPath = join(dir, entry)
        try {
          const stat = statSync(fullPath)

          if (stat.isDirectory()) {
            scanDir(fullPath)
          } else if (entry === 'annotations.db' && stat.size > 0) {
            databases.push(fullPath)
          }
        } catch {
          // Skip files/dirs we can't access
        }
      }
    } catch {
      // Skip directories we can't access
    }
  }

  scanDir(LOCAL_DATA_DIR)
  return databases
}

/**
 * Main execution
 */
function main() {
  console.log('Database Repair and Validation\n')

  // Load current schema
  const schemaSQL = readFileSync(SCHEMA_PATH, 'utf-8')
  const expectedTables = getExpectedTables(schemaSQL)
  console.log(`Expected tables (${expectedTables.size}):`, [...expectedTables].join(', '))
  console.log()

  // Find all databases
  const databases = findAllDatabases()
  console.log(`Found ${databases.length} databases\n`)

  // Repair each database
  const results: RepairResult[] = []

  for (let i = 0; i < databases.length; i++) {
    const dbPath = databases[i]
    if (!dbPath) continue

    process.stdout.write(`[${i + 1}/${databases.length}] Checking... `)

    const result = repairDatabase(dbPath, schemaSQL)
    results.push(result)

    if (result.status === 'current') {
      console.log('✓')
    } else if (result.status === 'repaired') {
      console.log('🔧 REPAIRED')
      for (const action of result.actions) {
        console.log(`  - ${action}`)
      }
    } else {
      console.log('✗ FAILED')
      console.error(`  Error: ${result.error}`)
    }
  }

  // Summary
  console.log('\n=== Repair Summary ===')
  const current = results.filter(r => r.status === 'current').length
  const repaired = results.filter(r => r.status === 'repaired').length
  const failed = results.filter(r => r.status === 'failed').length

  console.log(`Total databases: ${databases.length}`)
  console.log(`Current (v${CURRENT_SCHEMA_VERSION}): ${current} ✓`)
  console.log(`Repaired: ${repaired} 🔧`)
  console.log(`Failed: ${failed}`)

  // List failed databases
  if (failed > 0) {
    console.log('\nFailed databases:')
    results
      .filter(r => r.status === 'failed')
      .forEach(r => {
        console.log(`  - ${r.path}`)
        console.log(`    ${r.error}`)
      })
  }

  process.exit(failed > 0 ? 1 : 0)
}

main()
