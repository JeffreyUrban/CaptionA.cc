/**
 * Database migration utilities
 *
 * Applies migrations to existing annotations.db files
 */

import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
 * Apply migration 002: Add analysis_model_version to video_layout_config
 */
export function migrateAnalysisModelVersion(dbPath: string): boolean {
  const db = new Database(dbPath)
  try {
    // Check if migration is needed
    if (columnExists(db, 'video_layout_config', 'analysis_model_version')) {
      // Already migrated
      return false
    }

    console.log(`[Migration] Applying analysis_model_version migration to ${dbPath}`)

    // Read migration SQL
    const migrationPath = resolve(__dirname, 'migrations', '002_add_analysis_model_version.sql')
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
 * Apply migration 003: Drop cropped_frame_ocr table
 */
export function migrateDropCroppedFrameOCR(dbPath: string): boolean {
  const db = new Database(dbPath)
  try {
    // Check if table exists
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cropped_frame_ocr'")
      .all() as Array<{ name: string }>

    if (tables.length === 0) {
      // Table doesn't exist, nothing to do
      return false
    }

    console.log(`[Migration] Applying drop_cropped_frame_ocr migration to ${dbPath}`)

    // Read migration SQL
    const migrationPath = resolve(__dirname, 'migrations', '003_drop_cropped_frame_ocr.sql')
    const migrationSQL = readFileSync(migrationPath, 'utf-8')

    // Execute migration SQL (exec handles comments and multiple statements)
    db.exec(migrationSQL)

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
  migrateAnalysisModelVersion(dbPath)
  migrateDropCroppedFrameOCR(dbPath)
}
