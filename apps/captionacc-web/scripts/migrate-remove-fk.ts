#!/usr/bin/env node
/**
 * Migration: Remove foreign key constraint from ocr_box_annotations table
 *
 * The foreign key to frames_ocr prevents annotating full_frames frames
 * which don't exist in frames_ocr. This migration recreates the table without
 * the constraint.
 */

import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'

function findAnnotationsDatabases(baseDir: string): string[] {
  const databases: string[] = []

  function traverse(dir: string) {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = resolve(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        traverse(fullPath)
      } else if (entry === 'annotations.db') {
        databases.push(fullPath)
      }
    }
  }

  traverse(baseDir)
  return databases
}

function migrateDatabase(dbPath: string) {
  console.log(`Migrating: ${dbPath}`)

  const db = new Database(dbPath)

  try {
    // Begin transaction
    db.exec('BEGIN TRANSACTION')

    // Check if table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='ocr_box_annotations'
    `).get()

    if (!tableExists) {
      console.log('  ⚠️  Table ocr_box_annotations does not exist, skipping')
      db.exec('ROLLBACK')
      db.close()
      return
    }

    // Create new table without foreign key constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS ocr_box_annotations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        frame_index INTEGER NOT NULL,
        box_index INTEGER NOT NULL,

        -- Box identification (ORIGINAL non-cropped absolute pixel coords)
        box_text TEXT NOT NULL,
        box_left INTEGER NOT NULL,
        box_top INTEGER NOT NULL,
        box_right INTEGER NOT NULL,
        box_bottom INTEGER NOT NULL,

        -- Annotation
        label TEXT NOT NULL CHECK(label IN ('in', 'out')),
        annotation_source TEXT NOT NULL CHECK(annotation_source IN ('user', 'model')),

        -- Model prediction (for comparison)
        predicted_label TEXT CHECK(predicted_label IN ('in', 'out')),
        predicted_confidence REAL CHECK(predicted_confidence >= 0.0 AND predicted_confidence <= 1.0),
        model_version TEXT,

        -- Metadata
        annotated_at TEXT NOT NULL DEFAULT (datetime('now')),

        UNIQUE(frame_index, box_index)
      )
    `)

    // Copy data from old table to new table
    const rowCount = db.prepare('SELECT COUNT(*) as count FROM ocr_box_annotations').get() as { count: number }

    if (rowCount.count > 0) {
      db.exec(`
        INSERT INTO ocr_box_annotations_new
        SELECT * FROM ocr_box_annotations
      `)
      console.log(`  ✓ Copied ${rowCount.count} rows`)
    } else {
      console.log('  ℹ️  No existing data to migrate')
    }

    // Drop old table and rename new table
    db.exec('DROP TABLE ocr_box_annotations')
    db.exec('ALTER TABLE ocr_box_annotations_new RENAME TO ocr_box_annotations')

    // Recreate indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ocr_box_annotations_frame
      ON ocr_box_annotations(frame_index)
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ocr_box_annotations_user
      ON ocr_box_annotations(annotation_source, annotated_at)
      WHERE annotation_source = 'user'
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ocr_box_annotations_model_version
      ON ocr_box_annotations(model_version, annotation_source)
    `)

    // Commit transaction
    db.exec('COMMIT')

    console.log('  ✓ Migration successful')

  } catch (error) {
    console.error('  ✗ Migration failed:', error)
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

// Main
const localDataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

if (!existsSync(localDataDir)) {
  console.error(`Error: ${localDataDir} does not exist`)
  process.exit(1)
}

console.log('Finding annotations databases...')
const databases = findAnnotationsDatabases(localDataDir)

console.log(`Found ${databases.length} database(s)\n`)

for (const dbPath of databases) {
  migrateDatabase(dbPath)
}

console.log('\n✓ All migrations complete')
