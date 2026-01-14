#!/usr/bin/env node
/**
 * Initialize captions database for a video
 *
 * Usage: node scripts/init-captions-db.ts <video_path>
 * Example: node scripts/init-captions-db.ts content_name/video_id
 */

import { mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

import Database from 'better-sqlite3'

const videoPath = process.argv[2]

if (!videoPath) {
  console.error('Usage: node scripts/init-captions-db.ts <video_path>')
  console.error('Example: node scripts/init-captions-db.ts show_name/video_id')
  process.exit(1)
}

// Construct database path
const dbPath = resolve(
  process.cwd(),
  '..',
  '..',
  'local',
  'data',
  ...videoPath.split('/'),
  'captions.db'
)

console.log(`Initializing captions database at: ${dbPath}`)

// Ensure directory exists
mkdirSync(dirname(dbPath), { recursive: true })

// Create/open database
const db = new Database(dbPath)

// Load schema using centralized schema selection logic
const { getSchemaForNewDatabase } = await import('../app/db/schema-loader.js')
const schemaDir = resolve(process.cwd(), 'app', 'db')
const schema = getSchemaForNewDatabase(schemaDir)

// Execute schema
db.exec(schema.content)

console.log('Database schema created successfully')

// Insert schema version metadata
db.prepare(
  `INSERT OR REPLACE INTO database_metadata (id, schema_version, created_at) VALUES (1, ?, datetime('now'))`
).run(schema.version)

console.log(`Schema version ${schema.version} initialized`)

// Get total frames for this video (count frame files)
const { readdirSync } = await import('fs')
const framesDir = resolve(
  process.cwd(),
  '..',
  '..',
  'local',
  'data',
  ...videoPath.split('/'),
  'crop_frames'
)

const frameFiles = readdirSync(framesDir).filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
const totalFrames = frameFiles.length

console.log(`Video has ${totalFrames} frames`)

// Initialize with a single gap annotation covering all frames
const insertGap = db.prepare(`
  INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending)
  VALUES (?, ?, 'gap', 0)
`)

insertGap.run(0, totalFrames - 1)

console.log(`Created initial gap annotation: 0-${totalFrames - 1}`)

// Verify
const count = db.prepare('SELECT COUNT(*) as count FROM captions').get() as { count: number }
console.log(`Database initialized with ${count.count} annotation(s)`)

db.close()
console.log('Done!')
