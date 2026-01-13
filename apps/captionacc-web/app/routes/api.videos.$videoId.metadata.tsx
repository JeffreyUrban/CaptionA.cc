import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs } from 'react-router'
import sharp from 'sharp'

import { getCaptionsDbPath } from '~/utils/video-paths'

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
        INSERT INTO captions (start_frame_index, end_frame_index, caption_frame_extents_state, caption_frame_extents_pending)
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
      INSERT INTO captions (start_frame_index, end_frame_index, caption_frame_extents_state, caption_frame_extents_pending)
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
  const dbPath = await getCaptionsDbPath(videoId)
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
