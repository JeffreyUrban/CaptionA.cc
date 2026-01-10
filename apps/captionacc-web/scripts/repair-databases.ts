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
 *
 * Approach:
 * - Parse canonical schema file to extract expected structure
 * - Query actual schema using PRAGMA table_info
 * - Compare and fix: missing tables, missing columns
 * - Verify against actual schema, not historical CREATE statements
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'

import { CURRENT_SCHEMA_VERSION } from '../app/db/migrate'

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LOCAL_DATA_DIR = join(__dirname, '../../../!__local/data/_has_been_deprecated__!')
const SCHEMA_PATH = join(__dirname, '../app/db/annotations-schema-latest.sql')

interface RepairResult {
  path: string
  status: 'current' | 'repaired' | 'failed'
  actions: string[]
  error?: string
}

interface ColumnDefinition {
  name: string
  type: string
  notnull: boolean
  dflt_value: string | null
  pk: boolean
}

interface TableSchema {
  name: string
  columns: Map<string, ColumnDefinition>
}

/**
 * Parse schema SQL to extract table definitions with columns
 */
function parseSchemaSQL(schemaSQL: string): Map<string, TableSchema> {
  const tables = new Map<string, TableSchema>()

  // Match CREATE TABLE statements (handling multi-line)
  const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g
  let tableMatch

  while ((tableMatch = tableRegex.exec(schemaSQL)) !== null) {
    const tableName = tableMatch[1]
    const tableBody = tableMatch[2]

    if (!tableName || !tableBody) continue

    const columns = new Map<string, ColumnDefinition>()

    // Split by commas, but be careful with commas in CHECK constraints
    const lines = tableBody.split('\n')
    let currentColumn = ''

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip comments and empty lines
      if (trimmed.startsWith('--') || trimmed === '') continue

      // Skip table-level constraints
      if (
        trimmed.startsWith('PRIMARY KEY') ||
        trimmed.startsWith('FOREIGN KEY') ||
        trimmed.startsWith('UNIQUE') ||
        trimmed.startsWith('CHECK(')
      ) {
        continue
      }

      // Accumulate line
      currentColumn += ' ' + trimmed

      // Check if line ends with comma (end of column definition)
      if (trimmed.endsWith(',')) {
        parseColumnDefinition(currentColumn.trim().slice(0, -1), columns)
        currentColumn = ''
      }
    }

    // Handle last column (no trailing comma)
    if (currentColumn.trim()) {
      parseColumnDefinition(currentColumn.trim(), columns)
    }

    tables.set(tableName, { name: tableName, columns })
  }

  return tables
}

/**
 * Parse a single column definition
 */
function parseColumnDefinition(columnDef: string, columns: Map<string, ColumnDefinition>): void {
  // Extract column name (first word)
  const parts = columnDef.trim().split(/\s+/)
  const name = parts[0]

  if (!name) return

  // Extract type (second word, or default to TEXT)
  const type = parts[1] || 'TEXT'

  // Check for NOT NULL
  const notnull = columnDef.toUpperCase().includes('NOT NULL')

  // Check for PRIMARY KEY
  const pk = columnDef.toUpperCase().includes('PRIMARY KEY')

  // Extract default value (if any)
  let dflt_value: string | null = null
  const defaultMatch = columnDef.match(/DEFAULT\s+(.+?)(?:\s+|$|,)/i)
  if (defaultMatch?.[1]) {
    dflt_value = defaultMatch[1].trim()
  }

  columns.set(name, {
    name,
    type: type.toUpperCase(),
    notnull,
    dflt_value,
    pk,
  })
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
 * Get actual columns for a table using PRAGMA
 */
function getActualColumns(db: Database.Database, tableName: string): Map<string, ColumnDefinition> {
  const columns = new Map<string, ColumnDefinition>()

  const columnInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>

  for (const col of columnInfo) {
    columns.set(col.name, {
      name: col.name,
      type: col.type.toUpperCase(),
      notnull: !!col.notnull,
      dflt_value: col.dflt_value,
      pk: !!col.pk,
    })
  }

  return columns
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

    const expectedTables = parseSchemaSQL(schemaSQL)
    const actualTables = getActualTables(db)

    // Find missing tables
    const missingTables = [...expectedTables.keys()].filter(t => !actualTables.has(t))

    // Create missing tables
    if (missingTables.length > 0) {
      result.actions.push(`Missing tables: ${missingTables.join(', ')}`)
      result.status = 'repaired'

      // Apply full schema (CREATE TABLE IF NOT EXISTS is idempotent)
      db.exec(schemaSQL)

      result.actions.push('Created missing tables')

      // Refresh actual tables list
      actualTables.clear()
      for (const name of getActualTables(db)) {
        actualTables.add(name)
      }
    }

    // Check columns for each table
    for (const [tableName, expectedSchema] of expectedTables) {
      if (!actualTables.has(tableName)) continue // Table doesn't exist (shouldn't happen after above)

      const actualColumns = getActualColumns(db, tableName)
      const missingColumns = [...expectedSchema.columns.keys()].filter(
        col => !actualColumns.has(col)
      )

      if (missingColumns.length > 0) {
        result.status = 'repaired'

        for (const colName of missingColumns) {
          const colDef = expectedSchema.columns.get(colName)
          if (!colDef) continue

          // Build ALTER TABLE statement
          let alterSQL = `ALTER TABLE ${tableName} ADD COLUMN ${colDef.name} ${colDef.type}`

          // Note: SQLite doesn't support adding NOT NULL columns without a default
          // We'll add the column as nullable to avoid errors
          if (colDef.dflt_value) {
            alterSQL += ` DEFAULT ${colDef.dflt_value}`
          }

          try {
            db.exec(alterSQL)
            result.actions.push(`Added column: ${tableName}.${colName}`)
          } catch (error) {
            result.actions.push(`Failed to add ${tableName}.${colName}: ${error}`)
          }
        }
      }
    }

    // Verify or update version metadata
    const hasMetadata = actualTables.has('database_metadata')

    if (!hasMetadata) {
      result.actions.push('Missing database_metadata table')
      result.status = 'repaired'
    } else {
      try {
        const metadata = db.prepare('SELECT schema_version FROM database_metadata').get() as
          | { schema_version: number }
          | undefined

        if (!metadata) {
          result.actions.push('Missing version metadata row')
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
    }

    // If we made changes, ensure version is set correctly
    if (result.status === 'repaired') {
      const metadataExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='database_metadata'")
        .get()

      if (!metadataExists) {
        // Metadata table doesn't exist, create it
        db.exec(schemaSQL) // This will create it
      }

      // Check if row exists
      const rowExists = db.prepare('SELECT id FROM database_metadata WHERE id = 1').get()

      if (!rowExists) {
        // Insert initial row
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
        // Update existing row
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
 * Find all captions.db files recursively
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
          } else if (entry === 'captions.db' && stat.size > 0) {
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
  const expectedTables = parseSchemaSQL(schemaSQL)
  console.log(`Expected tables (${expectedTables.size}):`, [...expectedTables.keys()].join(', '))
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
