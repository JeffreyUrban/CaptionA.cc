/**
 * Database migration utilities
 *
 * Helper functions for creating future migrations
 */

import Database from 'better-sqlite3'

/**
 * Current schema version
 * Must match version in captions-schema-v{N}.sql
 */
export const CURRENT_SCHEMA_VERSION = 2

/**
 * Special version number for latest unreleased schema
 * Uses captions-schema-latest.sql (working schema, may have unreleased changes)
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
 * Migrate from v1 to v2
 * Adds image_needs_regen column to captions table
 */
function migrateV1ToV2(db: Database.Database): void {
  console.log('[Migration] Migrating from v1 to v2: Adding image_needs_regen column')

  // Add image_needs_regen column if it doesn't exist
  if (!columnExists(db, 'captions', 'image_needs_regen')) {
    db.prepare(
      `ALTER TABLE captions ADD COLUMN image_needs_regen INTEGER NOT NULL DEFAULT 0 CHECK(image_needs_regen IN (0, 1))`
    ).run()
    console.log('[Migration] Added image_needs_regen column')
  }

  // Update schema version in database_metadata
  if (tableExists(db, 'database_metadata')) {
    db.prepare(
      'UPDATE database_metadata SET schema_version = 2, migrated_at = datetime("now") WHERE id = 1'
    ).run()
  }
}

/**
 * Get current schema version from database
 */
function getCurrentVersion(db: Database.Database): number {
  if (!tableExists(db, 'database_metadata')) {
    return 0 // No metadata table = v0 (very old or new database)
  }

  const row = db.prepare('SELECT schema_version FROM database_metadata WHERE id = 1').get() as
    | { schema_version: number }
    | undefined

  return row?.schema_version ?? 0
}

/**
 * Apply all pending migrations to a database
 *
 * @param dbPath - Path to the database file
 */
export function migrateDatabase(dbPath: string): void {
  const db = new Database(dbPath)

  try {
    const currentVersion = getCurrentVersion(db)

    if (currentVersion === CURRENT_SCHEMA_VERSION) {
      // Already at current version
      return
    }

    console.log(
      `[Migration] Database at version ${currentVersion}, upgrading to ${CURRENT_SCHEMA_VERSION}`
    )

    // Apply migrations in sequence
    if (currentVersion < 2) {
      migrateV1ToV2(db)
    }

    console.log(`[Migration] Successfully migrated to version ${CURRENT_SCHEMA_VERSION}`)
  } finally {
    db.close()
  }
}
