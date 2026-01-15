/**
 * Initialize schema version 1 on all existing databases
 *
 * Adds database_metadata table and sets schema_version = 1 for all databases
 * that match the current standardized schema.
 *
 * Uses actual schema (PRAGMA table_info) for checksum verification,
 * not historical CREATE statements from sqlite_master.
 */

import { createHash } from 'crypto'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'

import Database from 'better-sqlite3'

const SCHEMA_VERSION = 1
const LOCAL_DATA_DIR = '../../local/data'

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

/**
 * Compute schema checksum from actual database structure using PRAGMA
 *
 * This provides accurate verification regardless of how tables/columns were created
 * (CREATE TABLE vs ALTER TABLE).
 */
function computeSchemaChecksum(db: Database.Database): string {
  // Get all tables (excluding internal SQLite tables and database_metadata)
  const tables = db
    .prepare(
      `
    SELECT name FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      AND name != 'database_metadata'
    ORDER BY name
  `
    )
    .all() as Array<{ name: string }>

  // Build canonical schema representation
  const schemaRepresentation: string[] = []

  for (const table of tables) {
    const tableName = table.name

    // Get actual columns using PRAGMA
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as ColumnInfo[]

    // Sort columns by name for consistency
    columns.sort((a, b) => a.name.localeCompare(b.name))

    // Add table header
    schemaRepresentation.push(`TABLE:${tableName}`)

    // Add each column
    for (const col of columns) {
      const colStr = `${col.name}|${col.type}|${col.notnull}|${col.dflt_value ?? 'NULL'}|${col.pk}`
      schemaRepresentation.push(colStr)
    }

    // Get indexes for this table
    const indexes = db
      .prepare(
        `
      SELECT name, sql FROM sqlite_master
      WHERE type='index'
        AND tbl_name = ?
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all(tableName) as Array<{ name: string; sql: string | null }>

    for (const index of indexes) {
      if (index.sql) {
        schemaRepresentation.push(`INDEX:${index.name}:${index.sql}`)
      }
    }
  }

  // Get triggers (if any)
  const triggers = db
    .prepare(
      `
    SELECT name, sql FROM sqlite_master
    WHERE type='trigger'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `
    )
    .all() as Array<{ name: string; sql: string | null }>

  for (const trigger of triggers) {
    if (trigger.sql) {
      schemaRepresentation.push(`TRIGGER:${trigger.name}:${trigger.sql}`)
    }
  }

  // Join and hash
  const schemaString = schemaRepresentation.join('\n')
  return createHash('sha256').update(schemaString).digest('hex')
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

    // Compute checksum from actual schema
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
 * Find all captions.db files recursively
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
      } else if (entry === 'captions.db' && stat.size > 0) {
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
