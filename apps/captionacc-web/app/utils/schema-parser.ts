/**
 * Schema parsing utilities
 *
 * Uses SQLite's built-in parser to extract schema information.
 * This is more robust than custom text parsing - SQLite handles all edge cases correctly.
 */

import Database from 'better-sqlite3'

export interface ColumnDefinition {
  name: string
  type: string
  notnull: boolean
  dflt_value: string | null
  pk: boolean
}

export interface TableSchemaFull {
  name: string
  columns: Map<string, ColumnDefinition>
}

export interface TableSchemaNames {
  name: string
  columns: Set<string>
}

/**
 * Parse schema SQL to extract full table definitions with column details
 * Uses SQLite's parser by creating a temp in-memory database
 */
export function parseSchemaFull(schemaSQL: string): Map<string, TableSchemaFull> {
  // Create temporary in-memory database
  const db = new Database(':memory:')

  try {
    // Let SQLite parse the schema SQL
    db.exec(schemaSQL)

    // Get all table names (excluding SQLite internal tables)
    const tables = db
      .prepare(
        `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `
      )
      .all() as Array<{ name: string }>

    const result = new Map<string, TableSchemaFull>()

    // For each table, get column information using PRAGMA
    for (const { name: tableName } of tables) {
      const columns = new Map<string, ColumnDefinition>()

      const columnInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        cid: number
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

      result.set(tableName, { name: tableName, columns })
    }

    return result
  } finally {
    db.close()
  }
}

/**
 * Parse schema SQL to extract table definitions with column names only
 * Used by admin service for status checking
 */
export function parseSchemaNames(schemaSQL: string): Map<string, TableSchemaNames> {
  const fullSchema = parseSchemaFull(schemaSQL)
  const tables = new Map<string, TableSchemaNames>()

  for (const [tableName, tableSchema] of fullSchema) {
    const columnNames = new Set(tableSchema.columns.keys())
    tables.set(tableName, { name: tableName, columns: columnNames })
  }

  return tables
}
