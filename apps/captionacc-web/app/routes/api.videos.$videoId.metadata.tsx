import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs } from 'react-router'
import sharp from 'sharp'

import { getDbPath } from '~/utils/video-paths'

function getOrCreateDatabase(videoId: string) {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  const dbExists = existsSync(dbPath)
  const db = new Database(dbPath)

  // If database is new, create the schema
  if (!dbExists) {
    // NOTE: This inline schema creation is deprecated.
    // Use scripts/init-annotations-db.ts for new databases.
    // This remains for backwards compatibility.
    db.exec(`
      CREATE TABLE IF NOT EXISTS annotations (
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
        text_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_annotations_frame_range
      ON annotations(start_frame_index, end_frame_index);

      CREATE INDEX IF NOT EXISTS idx_annotations_granularity
      ON annotations((start_frame_index / 100) * 100);

      CREATE INDEX IF NOT EXISTS idx_annotations_boundary_pending
      ON annotations(boundary_pending, boundary_state, start_frame_index);

      CREATE INDEX IF NOT EXISTS idx_annotations_text_pending
      ON annotations(text_pending, start_frame_index);

      CREATE TRIGGER IF NOT EXISTS update_boundary_timestamp
      AFTER UPDATE OF start_frame_index, end_frame_index, boundary_state, boundary_pending ON annotations
      BEGIN
        UPDATE captions
        SET boundary_updated_at = datetime('now')
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_text_timestamp
      AFTER UPDATE OF text, text_pending, text_status, text_notes, text_ocr_combined ON annotations
      BEGIN
        UPDATE captions
        SET text_updated_at = datetime('now')
        WHERE id = NEW.id;
      END;
    `)
  }

  return db
}

function fillAnnotationGaps(db: Database.Database, totalFrames: number): number {
  // Find all gaps in annotation coverage and create gap annotations for them
  // Returns the number of gap annotations created

  // Get all existing annotations sorted by start_frame_index
  const annotations = db
    .prepare(
      `
    SELECT start_frame_index, end_frame_index
    FROM captions
    ORDER BY start_frame_index
  `
    )
    .all() as Array<{ start_frame_index: number; end_frame_index: number }>

  let gapsCreated = 0
  let expectedFrame = 0

  for (const annotation of annotations) {
    // Check if there's a gap before this annotation
    if (annotation.start_frame_index > expectedFrame) {
      // Create gap annotation for frames [expectedFrame, annotation.start_frame_index - 1]
      db.prepare(
        `
        INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending)
        VALUES (?, ?, 'gap', 0)
      `
      ).run(expectedFrame, annotation.start_frame_index - 1)
      gapsCreated++
    }

    // Move expectedFrame to after this annotation
    expectedFrame = Math.max(expectedFrame, annotation.end_frame_index + 1)
  }

  // Check if there's a gap at the end
  if (expectedFrame < totalFrames) {
    db.prepare(
      `
      INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending)
      VALUES (?, ?, 'gap', 0)
    `
    ).run(expectedFrame, totalFrames - 1)
    gapsCreated++
  }

  return gapsCreated
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Decode the URL-encoded videoId
  const videoId = decodeURIComponent(encodedVideoId)

  // Get database path
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response(JSON.stringify({ error: 'Video not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check if database exists
  if (!existsSync(dbPath)) {
    return new Response(JSON.stringify({ error: 'Database not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Get total frames from database (cropped_frames table)
  const db = new Database(dbPath)
  let totalFrames = 0
  let cropWidth = 0
  let cropHeight = 0

  try {
    // Count total number of frames in cropped_frames table
    const result = db.prepare('SELECT COUNT(*) as count FROM cropped_frames').get() as {
      count: number
    }

    totalFrames = result.count

    if (totalFrames === 0) {
      db.close()
      return new Response(JSON.stringify({ error: 'No cropped frames found in database' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get crop dimensions from first frame
    const frameRow = db.prepare('SELECT image_data FROM cropped_frames LIMIT 1').get() as
      | { image_data: Buffer }
      | undefined

    if (frameRow) {
      const metadata = await sharp(frameRow.image_data).metadata()
      cropWidth = metadata.width || 0
      cropHeight = metadata.height || 0
    }
  } catch (error) {
    console.error('Error querying cropped_frames:', error)
    db.close()
    return new Response(JSON.stringify({ error: 'Failed to query frame count from database' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fill any gaps in annotation coverage
  let gapsCreated = 0

  try {
    gapsCreated = fillAnnotationGaps(db, totalFrames)
  } catch (error) {
    console.error('Error filling annotation gaps:', error)
  } finally {
    db.close()
  }

  return new Response(
    JSON.stringify({
      videoId,
      totalFrames,
      firstFrame: 0,
      lastFrame: totalFrames - 1,
      cropWidth,
      cropHeight,
      gapsCreated, // Include info about gaps that were filled
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
