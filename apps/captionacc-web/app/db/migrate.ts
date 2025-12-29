/**
 * Database migration utilities
 *
 * Applies migrations to existing annotations.db files
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'

/**
 * Check if a column exists in a table
 */
function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return columns.some(col => col.name === columnName)
}

/**
 * Apply migration 001: Add crop bounds to cropped_frames
 */
export function migrateCropBounds(dbPath: string): boolean {
  const db = new Database(dbPath)
  try {
    // Check if migration is needed
    if (columnExists(db, 'cropped_frames', 'crop_left')) {
      // Already migrated
      return false
    }

    console.log(`[Migration] Applying crop_bounds migration to ${dbPath}`)

    // Read migration SQL
    const migrationPath = resolve(
      __dirname,
      'migrations',
      '001_add_crop_bounds_to_cropped_frames.sql'
    )
    const migrationSQL = readFileSync(migrationPath, 'utf-8')

    // Split by semicolon and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    for (const statement of statements) {
      db.prepare(statement).run()
    }

    console.log(`[Migration] Successfully migrated ${dbPath}`)
    return true
  } catch (error) {
    console.error(`[Migration] Failed to migrate ${dbPath}:`, error)
    throw error
  } finally {
    db.close()
  }
}

/**
 * Apply all pending migrations to a database
 */
export function migrateDatabase(dbPath: string): void {
  migrateCropBounds(dbPath)
  // Add more migrations here as needed
}
