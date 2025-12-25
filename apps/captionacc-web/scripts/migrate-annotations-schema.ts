#!/usr/bin/env node
/**
 * Migrate existing annotations databases to new schema
 *
 * Changes:
 * - Rename state → boundary_state
 * - Rename pending → boundary_pending
 * - Add text_pending, status, notes, combined_ocr_text fields
 * - Create frames table
 * - Add new indexes
 *
 * Usage: node scripts/migrate-annotations-schema.ts [video_path]
 * Example: node scripts/migrate-annotations-schema.ts content_name/video_id
 *          node scripts/migrate-annotations-schema.ts --all (migrate all videos)
 */

import Database from 'better-sqlite3'
import { resolve, dirname } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'

const args = process.argv.slice(2)

if (args.length === 0 || (args[0] !== '--all' && !args[0])) {
  console.error('Usage: node scripts/migrate-annotations-schema.ts <video_path>')
  console.error('       node scripts/migrate-annotations-schema.ts --all')
  console.error('Example: node scripts/migrate-annotations-schema.ts show_name/video_id')
  process.exit(1)
}

function migrateDatabase(dbPath: string, videoPath: string): boolean {
  if (!existsSync(dbPath)) {
    console.log(`  ⊘ Database not found: ${videoPath}`)
    return false
  }

  console.log(`  Migrating: ${videoPath}`)

  const db = new Database(dbPath)

  try {
    // Check migration status
    const tableInfo = db.prepare("PRAGMA table_info(annotations)").all() as Array<{ name: string }>
    const hasOldSchema = tableInfo.some(col => col.name === 'state')
    const hasIntermediateSchema = tableInfo.some(col => col.name === 'boundary_state') && tableInfo.some(col => col.name === 'status')
    const hasNewSchema = tableInfo.some(col => col.name === 'boundary_state') && tableInfo.some(col => col.name === 'text_status')

    // Check if frames_ocr and video_preferences tables exist
    const framesOcrExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='frames_ocr'").get()
    const videoPrefsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='video_preferences'").get()

    // Check if video_preferences has correct schema (REAL text_size and padding_scale, TEXT text_anchor)
    let videoPrefsHasCorrectSchema = false
    if (videoPrefsExists) {
      const prefTableInfo = db.prepare("PRAGMA table_info(video_preferences)").all() as Array<{ name: string, type: string }>
      const hasTextSize = prefTableInfo.some(col => col.name === 'text_size' && col.type === 'REAL')
      const hasPaddingScale = prefTableInfo.some(col => col.name === 'padding_scale' && col.type === 'REAL')
      const hasTextAnchor = prefTableInfo.some(col => col.name === 'text_anchor' && col.type === 'TEXT')
      videoPrefsHasCorrectSchema = hasTextSize && hasPaddingScale && hasTextAnchor
    }

    if (hasNewSchema && framesOcrExists && videoPrefsExists && videoPrefsHasCorrectSchema) {
      console.log(`  ✓ Already migrated: ${videoPath}`)
      db.close()
      return true
    }

    if (!hasOldSchema && !hasIntermediateSchema && !hasNewSchema) {
      console.log(`  ⚠ Unexpected schema: ${videoPath}`)
      db.close()
      return false
    }

    // Begin transaction
    db.exec('BEGIN TRANSACTION')

    try {
      // SQLite doesn't support renaming columns directly before version 3.25.0
      // Use ALTER TABLE ADD COLUMN + UPDATE + DROP approach

      if (hasOldSchema) {
        console.log('    - Adding new columns (phase 1)...')

        // Add boundary_state and copy from state
        db.exec(`ALTER TABLE annotations ADD COLUMN boundary_state TEXT`)
        db.exec(`UPDATE annotations SET boundary_state = state`)
        db.exec(`UPDATE annotations SET boundary_state = 'predicted' WHERE boundary_state IS NULL`)

        // Add boundary_pending and copy from pending
        db.exec(`ALTER TABLE annotations ADD COLUMN boundary_pending INTEGER DEFAULT 0`)
        db.exec(`UPDATE annotations SET boundary_pending = pending`)
        db.exec(`UPDATE annotations SET boundary_pending = 0 WHERE boundary_pending IS NULL`)

        // Add text_pending
        db.exec(`ALTER TABLE annotations ADD COLUMN text_pending INTEGER NOT NULL DEFAULT 0`)
      }

      if (hasOldSchema || hasIntermediateSchema) {
        console.log('    - Adding new columns (phase 2)...')

        // Add renamed text columns (copy from old names if they exist)
        if (!tableInfo.some(col => col.name === 'boundary_updated_at')) {
          db.exec(`ALTER TABLE annotations ADD COLUMN boundary_updated_at TEXT`)
          db.exec(`UPDATE annotations SET boundary_updated_at = COALESCE(updated_at, datetime('now'))`)
        }

        if (!tableInfo.some(col => col.name === 'text_status')) {
          db.exec(`ALTER TABLE annotations ADD COLUMN text_status TEXT`)
          db.exec(`UPDATE annotations SET text_status = status`)
        }

        if (!tableInfo.some(col => col.name === 'text_notes')) {
          db.exec(`ALTER TABLE annotations ADD COLUMN text_notes TEXT`)
          db.exec(`UPDATE annotations SET text_notes = notes`)
        }

        if (!tableInfo.some(col => col.name === 'text_ocr_combined')) {
          db.exec(`ALTER TABLE annotations ADD COLUMN text_ocr_combined TEXT`)
          db.exec(`UPDATE annotations SET text_ocr_combined = combined_ocr_text`)
        }

        if (!tableInfo.some(col => col.name === 'text_updated_at')) {
          db.exec(`ALTER TABLE annotations ADD COLUMN text_updated_at TEXT`)
          // Leave NULL - will be set when first text annotation is saved
        }

        // Reset text_updated_at to NULL for annotations without text annotation
        // (Fix for previous migration that incorrectly populated this field)
        db.exec(`UPDATE annotations SET text_updated_at = NULL WHERE text IS NULL`)
      }

      console.log('    - Creating frames_ocr table...')

      // Create frames_ocr table (frame OCR data independent of annotations)
      db.exec(`
        CREATE TABLE IF NOT EXISTS frames_ocr (
          frame_index INTEGER PRIMARY KEY,
          ocr_text TEXT,
          ocr_annotations TEXT,
          ocr_confidence REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)

      console.log('    - Creating video_preferences table...')

      // Check if video_preferences table exists and has old schema
      const prefTableInfo = db.prepare("PRAGMA table_info(video_preferences)").all() as Array<{ name: string, type: string }>
      const hasOldTextSchema = prefTableInfo.length > 0 && prefTableInfo.some(col => col.name === 'text_size' && col.type === 'TEXT')
      const hasOldIntegerSchema = prefTableInfo.length > 0 && prefTableInfo.some(col => col.name === 'text_size' && col.type === 'INTEGER')
      const missingPaddingScale = prefTableInfo.length > 0 && !prefTableInfo.some(col => col.name === 'padding_scale')
      const missingTextAnchor = prefTableInfo.length > 0 && !prefTableInfo.some(col => col.name === 'text_anchor')

      if (hasOldTextSchema || hasOldIntegerSchema || missingPaddingScale || missingTextAnchor) {
        console.log('    - Migrating video_preferences schema...')
        db.exec(`DROP TABLE video_preferences`)
      }

      // Create video_preferences table for per-video settings (if not exists with correct schema)
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_preferences (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          text_size REAL DEFAULT 3.0 CHECK(text_size >= 1.0 AND text_size <= 10.0),
          padding_scale REAL DEFAULT 0.75 CHECK(padding_scale >= 0.0 AND padding_scale <= 2.0),
          text_anchor TEXT DEFAULT 'left' CHECK(text_anchor IN ('left', 'center', 'right')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)

      // Insert default preferences if not exists
      db.exec(`INSERT OR IGNORE INTO video_preferences (id, text_size, padding_scale, text_anchor) VALUES (1, 3.0, 0.75, 'left')`)

      console.log('    - Creating new indexes...')

      // Drop old indexes
      db.exec('DROP INDEX IF EXISTS idx_annotations_pending_gap')
      db.exec('DROP INDEX IF EXISTS idx_frames_annotation')
      db.exec('DROP INDEX IF EXISTS idx_frames_unique')

      // Create new indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_boundary_pending
        ON annotations(boundary_pending, boundary_state, start_frame_index)
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_text_pending
        ON annotations(text_pending, start_frame_index)
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_text_null
        ON annotations((text IS NULL), text_pending, start_frame_index)
      `)

      console.log('    - Creating new table with renamed columns...')

      // Create new table with correct schema
      db.exec(`
        CREATE TABLE annotations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          start_frame_index INTEGER NOT NULL,
          end_frame_index INTEGER NOT NULL,
          boundary_state TEXT NOT NULL DEFAULT 'predicted' CHECK(boundary_state IN ('predicted', 'confirmed', 'gap')),
          boundary_pending INTEGER NOT NULL DEFAULT 0 CHECK(boundary_pending IN (0, 1)),
          boundary_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          text TEXT,
          text_pending INTEGER NOT NULL DEFAULT 0 CHECK(text_pending IN (0, 1)),
          text_status TEXT CHECK(text_status IN ('valid_caption', 'ocr_error', 'partial_caption', 'text_unclear', 'other_issue')),
          text_notes TEXT,
          text_ocr_combined TEXT,
          text_updated_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)

      // Copy data to new table
      db.exec(`
        INSERT INTO annotations_new (
          id, start_frame_index, end_frame_index,
          boundary_state, boundary_pending, boundary_updated_at,
          text, text_pending, text_status, text_notes, text_ocr_combined, text_updated_at,
          created_at
        )
        SELECT
          id, start_frame_index, end_frame_index,
          boundary_state, boundary_pending, boundary_updated_at,
          text, text_pending, text_status, text_notes, text_ocr_combined, text_updated_at,
          created_at
        FROM annotations
      `)

      // Drop old table and rename new one
      db.exec('DROP TABLE annotations')
      db.exec('ALTER TABLE annotations_new RENAME TO annotations')

      // Recreate indexes on new table
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_frame_range
        ON annotations(start_frame_index, end_frame_index)
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_granularity
        ON annotations((start_frame_index / 100) * 100)
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_boundary_pending
        ON annotations(boundary_pending, boundary_state, start_frame_index)
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_text_pending
        ON annotations(text_pending, start_frame_index)
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_annotations_text_null
        ON annotations((text IS NULL), text_pending, start_frame_index)
      `)

      // Recreate triggers
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS update_boundary_timestamp
        AFTER UPDATE OF start_frame_index, end_frame_index, boundary_state, boundary_pending ON annotations
        BEGIN
          UPDATE annotations
          SET boundary_updated_at = datetime('now')
          WHERE id = NEW.id;
        END
      `)

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS update_text_timestamp
        AFTER UPDATE OF text, text_status, text_notes ON annotations
        BEGIN
          UPDATE annotations
          SET text_updated_at = datetime('now')
          WHERE id = NEW.id;
        END
      `)

      // Commit transaction
      db.exec('COMMIT')

      console.log(`  ✓ Migration successful: ${videoPath}`)
      return true

    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

  } catch (error) {
    console.error(`  ✗ Migration failed for ${videoPath}:`, error)
    return false
  } finally {
    db.close()
  }
}

function findAllVideoDatabases(dataDir: string): string[] {
  const databases: string[] = []

  function scan(dir: string) {
    if (!existsSync(dir)) return

    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name)

      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.name === 'annotations.db') {
        // Get relative path from data dir
        const relativePath = fullPath.substring(dataDir.length + 1)
        const videoPath = dirname(relativePath)
        databases.push(videoPath)
      }
    }
  }

  scan(dataDir)
  return databases
}

// Main execution
const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

if (args[0] === '--all') {
  console.log('Migrating all video databases...')
  const videoPaths = findAllVideoDatabases(dataDir)

  if (videoPaths.length === 0) {
    console.log('No video databases found.')
    process.exit(0)
  }

  console.log(`Found ${videoPaths.length} video database(s)\n`)

  let successCount = 0
  let failCount = 0

  for (const videoPath of videoPaths) {
    const dbPath = resolve(dataDir, videoPath, 'annotations.db')
    const success = migrateDatabase(dbPath, videoPath)
    if (success) successCount++
    else failCount++
  }

  console.log(`\nMigration complete: ${successCount} succeeded, ${failCount} failed`)

} else {
  const videoPath = args[0]
  const dbPath = resolve(dataDir, ...videoPath.split('/'), 'annotations.db')

  console.log(`Migrating single video database: ${videoPath}\n`)
  const success = migrateDatabase(dbPath, videoPath)

  if (success) {
    console.log('\nMigration successful!')
    process.exit(0)
  } else {
    console.log('\nMigration failed!')
    process.exit(1)
  }
}
