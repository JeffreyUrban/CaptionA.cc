/**
 * Initialize schema version 1 on all existing databases
 *
 * Adds database_metadata table and sets schema_version = 1 for all databases
 * that match the current standardized schema.
 */

import { createHash } from 'crypto'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'

import Database from 'better-sqlite3'

const SCHEMA_VERSION = 1
const LOCAL_DATA_DIR = '../../local/data'

/**
 * Compute schema checksum for verification
 */
function computeSchemaChecksum(db: Database.Database): string {
  const schema = db
    .prepare(
      `
    SELECT sql FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite_%'
      AND name != 'database_metadata'
    ORDER BY type, name
  `
    )
    .all() as Array<{ sql: string }>

  const schemaSQL = schema.map(s => s.sql).join('\n')
  return createHash('sha256').update(schemaSQL).digest('hex')
}

/**
 * Check if database has metadata table
 */
function hasMetadataTable(db: Database.Database): boolean {
  const result = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='database_metadata'")
    .get()
  return !!result
}

/**
 * Initialize version 1 on a single database
 */
function initializeVersion(dbPath: string): { success: boolean; error?: string } {
  const db = new Database(dbPath)

  try {
    // Check if already initialized
    if (hasMetadataTable(db)) {
      const existing = db.prepare('SELECT schema_version FROM database_metadata').get() as
        | { schema_version: number }
        | undefined

      if (existing) {
        db.close()
        return { success: true, error: `Already at version ${existing.schema_version}` }
      }
    }

    // Create metadata table
    db.exec(`
      CREATE TABLE IF NOT EXISTS database_metadata (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          schema_version INTEGER NOT NULL,
          schema_checksum TEXT,
          created_at TEXT NOT NULL,
          migrated_at TEXT,
          verified_at TEXT
      )
    `)

    // Compute checksum
    const checksum = computeSchemaChecksum(db)

    // Insert version 1
    db.prepare(
      `
      INSERT INTO database_metadata (
        schema_version,
        schema_checksum,
        created_at,
        verified_at
      ) VALUES (?, ?, datetime('now'), datetime('now'))
    `
    ).run(SCHEMA_VERSION, checksum)

    db.close()
    return { success: true }
  } catch (error) {
    db.close()
    return { success: false, error: String(error) }
  }
}

/**
 * Find all annotations.db files recursively
 */
function findAllDatabases(): string[] {
  const databases: string[] = []

  function scanDir(dir: string) {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        scanDir(fullPath)
      } else if (entry === 'annotations.db' && stat.size > 0) {
        databases.push(fullPath)
      }
    }
  }

  scanDir(LOCAL_DATA_DIR)
  return databases
}

/**
 * Main execution
 */
function main() {
  console.log('Initializing schema version on all databases...\n')

  const databases = findAllDatabases()
  console.log(`Found ${databases.length} databases\n`)

  const results = {
    initialized: 0,
    alreadyVersioned: 0,
    failed: 0,
  }

  for (let i = 0; i < databases.length; i++) {
    const dbPath = databases[i]
    if (!dbPath) continue

    const displayPath = dbPath.replace(LOCAL_DATA_DIR + '/', '')
    process.stdout.write(`[${i + 1}/${databases.length}] ${displayPath}... `)

    const result = initializeVersion(dbPath)

    if (result.success) {
      if (result.error) {
        console.log('⏭')
        results.alreadyVersioned++
      } else {
        console.log('✓')
        results.initialized++
      }
    } else {
      console.log('✗')
      console.error(`  Error: ${result.error}`)
      results.failed++
    }
  }

  console.log('\n=== Initialization Summary ===')
  console.log(`Total databases: ${databases.length}`)
  console.log(`Initialized to v${SCHEMA_VERSION}: ${results.initialized}`)
  console.log(`Already versioned: ${results.alreadyVersioned}`)
  console.log(`Failed: ${results.failed}`)

  if (results.failed > 0) {
    process.exit(1)
  }
}

main()
