/**
 * Audit all database schemas to find variations
 *
 * Identifies:
 * - Tables that exist in some databases but not others
 * - Columns that exist in some databases but not others
 * - Any schema drift from expected standard
 */

import { readdirSync, statSync } from 'fs'
import { join } from 'path'

import Database from 'better-sqlite3'

const LOCAL_DATA_DIR = '../../local/data'

interface TableSchema {
  name: string
  columns: Map<string, ColumnInfo>
}

interface ColumnInfo {
  type: string
  notnull: boolean
  dflt_value: string | null
}

/**
 * Get schema for a database
 */
function getDatabaseSchema(dbPath: string): Map<string, TableSchema> {
  const db = new Database(dbPath, { readonly: true })
  const tables = new Map<string, TableSchema>()

  try {
    // Get all tables (excluding sqlite internal tables)
    const tableList = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all() as Array<{ name: string }>

    for (const { name: tableName } of tableList) {
      const columns = new Map<string, ColumnInfo>()

      // Get columns for this table
      const columnList = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
      }>

      for (const col of columnList) {
        columns.set(col.name, {
          type: col.type,
          notnull: !!col.notnull,
          dflt_value: col.dflt_value,
        })
      }

      tables.set(tableName, { name: tableName, columns })
    }
  } finally {
    db.close()
  }

  return tables
}

/**
 * Find all captions.db files
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
  console.log('Auditing database schemas...\n')

  const databases = findAllDatabases()
  console.log(`Found ${databases.length} databases\n`)

  // Collect all unique tables and columns
  const allTables = new Map<string, Set<string>>() // table -> set of databases
  const tableColumns = new Map<string, Map<string, Set<string>>>() // table -> column -> set of databases

  let processed = 0
  for (const dbPath of databases) {
    processed++
    if (processed % 50 === 0) {
      process.stdout.write(`\rProcessed ${processed}/${databases.length}...`)
    }

    try {
      const schema = getDatabaseSchema(dbPath)
      const shortPath = dbPath.replace(LOCAL_DATA_DIR + '/', '')

      for (const [tableName, tableSchema] of schema) {
        // Track which databases have this table
        if (!allTables.has(tableName)) {
          allTables.set(tableName, new Set())
        }
        allTables.get(tableName)!.add(shortPath)

        // Track which databases have each column
        if (!tableColumns.has(tableName)) {
          tableColumns.set(tableName, new Map())
        }
        const colMap = tableColumns.get(tableName)!

        for (const [colName] of tableSchema.columns) {
          if (!colMap.has(colName)) {
            colMap.set(colName, new Set())
          }
          colMap.get(colName)!.add(shortPath)
        }
      }
    } catch (error) {
      console.error(`\nError reading ${dbPath}:`, error)
    }
  }

  console.log(`\r\nProcessed ${databases.length} databases\n`)

  // Report findings
  console.log('=== Schema Audit Results ===\n')

  // Tables present in all databases
  const universalTables = Array.from(allTables.entries())
    .filter(([_, dbs]) => dbs.size === databases.length)
    .map(([name]) => name)
    .sort()

  console.log(`Tables in ALL databases (${universalTables.length}):`)
  universalTables.forEach(name => console.log(`  ✓ ${name}`))
  console.log()

  // Tables in SOME databases
  const partialTables = Array.from(allTables.entries())
    .filter(([_, dbs]) => dbs.size < databases.length && dbs.size > 0)
    .sort((a, b) => b[1].size - a[1].size)

  if (partialTables.length > 0) {
    console.log(`Tables in SOME databases (${partialTables.length}):`)
    partialTables.forEach(([name, dbs]) => {
      console.log(`  ⚠ ${name} (in ${dbs.size}/${databases.length} databases)`)
    })
    console.log()
  }

  // Column variations
  console.log('=== Column Variations ===\n')

  for (const tableName of universalTables) {
    const colMap = tableColumns.get(tableName)!
    const allColumns = Array.from(colMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))

    const universalCols = allColumns.filter(([_, dbs]) => dbs.size === databases.length)
    const partialCols = allColumns.filter(([_, dbs]) => dbs.size < databases.length && dbs.size > 0)

    if (partialCols.length > 0) {
      console.log(`Table: ${tableName}`)
      console.log(`  Universal columns (${universalCols.length}):`)
      universalCols.forEach(([name]) => console.log(`    ✓ ${name}`))

      console.log(`  Partial columns (${partialCols.length}):`)
      partialCols.forEach(([name, dbs]) => {
        console.log(`    ⚠ ${name} (in ${dbs.size}/${databases.length} databases)`)
      })
      console.log()
    }
  }

  console.log('=== Summary ===')
  console.log(`Total databases: ${databases.length}`)
  console.log(`Universal tables: ${universalTables.length}`)
  console.log(`Partial tables: ${partialTables.length}`)
  console.log()
}

main()
