/**
 * Database migration utilities
 *
 * Helper functions for creating future migrations
 */

import Database from 'better-sqlite3'

/**
 * Current schema version
 * Must match version in annotations-schema.sql
 */
export const CURRENT_SCHEMA_VERSION = 2

/**
 * Special version number for latest unreleased schema
 * Uses annotations-schema.sql (working schema, may have unreleased changes)
 */
export const LATEST_SCHEMA_VERSION = -1

/**
 * Check if a column exists in a table
 */
export function columnExists(
  db: Database.Database,
  tableName: string,
  columnName: string
): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return columns.some(col => col.name === columnName)
}

/**
 * Check if a table exists in the database
 */
export function tableExists(db: Database.Database, tableName: string): boolean {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .all(tableName) as Array<{ name: string }>
  return tables.length > 0
}

/**
 * Apply all pending migrations to a database
 *
 * Currently no migrations - all databases must match current schema.
 * Future migrations will be added here.
 */
export function migrateDatabase(_dbPath: string): void {
  // No migrations currently
}
