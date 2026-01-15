import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs } from 'react-router'
import sharp from 'sharp'

import { getDbPath } from '~/utils/video-paths'

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
  const dbPath = await getDbPath(videoId)
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
