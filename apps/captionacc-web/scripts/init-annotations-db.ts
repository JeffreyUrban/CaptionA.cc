#!/usr/bin/env node
/**
 * Initialize annotations database for a video
 *
 * Usage: node scripts/init-annotations-db.ts <video_path>
 * Example: node scripts/init-annotations-db.ts content_name/video_id
 */

import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { mkdirSync } from 'fs'

const videoPath = process.argv[2]

if (!videoPath) {
  console.error('Usage: node scripts/init-annotations-db.ts <video_path>')
  console.error('Example: node scripts/init-annotations-db.ts show_name/video_id')
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
  'annotations.db'
)

console.log(`Initializing annotations database at: ${dbPath}`)

// Ensure directory exists
mkdirSync(dirname(dbPath), { recursive: true })

// Create/open database
const db = new Database(dbPath)

// Read schema
const schemaPath = resolve(process.cwd(), 'app', 'db', 'annotations-schema.sql')
const schema = readFileSync(schemaPath, 'utf-8')

// Execute schema
db.exec(schema)

console.log('Database schema created successfully')

// Get total frames for this video (count frame files)
const { readdirSync } = await import('fs')
const framesDir = resolve(
  process.cwd(),
  '..',
  '..',
  'local',
  'data',
  ...videoPath.split('/'),
  'caption_frames'
)

const frameFiles = readdirSync(framesDir).filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
const totalFrames = frameFiles.length

console.log(`Video has ${totalFrames} frames`)

// Initialize with a single gap annotation covering all frames
const insertGap = db.prepare(`
  INSERT INTO annotations (start_frame_index, end_frame_index, state, pending)
  VALUES (?, ?, 'gap', 0)
`)

insertGap.run(0, totalFrames - 1)

console.log(`Created initial gap annotation: 0-${totalFrames - 1}`)

// Verify
const count = db.prepare('SELECT COUNT(*) as count FROM annotations').get() as { count: number }
console.log(`Database initialized with ${count.count} annotation(s)`)

db.close()
console.log('Done!')
