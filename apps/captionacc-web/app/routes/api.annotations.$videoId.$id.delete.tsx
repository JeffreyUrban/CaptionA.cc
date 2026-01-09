import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { deleteCombinedImage } from '~/utils/image-processing'
import { getDbPath } from '~/utils/video-paths'

async function getDatabase(videoId: string): Promise<Database.Database | Response> {
  const dbPath = await getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// DELETE - Delete annotation and replace with gap, merging adjacent gaps
export async function action({ params }: ActionFunctionArgs) {
  const { videoId: encodedVideoId, id } = params

  if (!encodedVideoId || !id) {
    return new Response(JSON.stringify({ error: 'Missing videoId or id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const annotationId = parseInt(id)

  try {
    const db = await getDatabase(videoId)
    if (db instanceof Response) return db

    // Get the annotation to delete
    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as
      | {
          id: number
          start_frame_index: number
          end_frame_index: number
        }
      | undefined

    if (!annotation) {
      db.close()
      return new Response(JSON.stringify({ error: 'Annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { start_frame_index, end_frame_index } = annotation

    // Find adjacent gap annotations
    const adjacentGaps = db
      .prepare(
        `
      SELECT * FROM captions
      WHERE boundary_state = 'gap'
      AND (
        end_frame_index = ? - 1
        OR start_frame_index = ? + 1
      )
      ORDER BY start_frame_index
    `
      )
      .all(start_frame_index, end_frame_index) as Array<{
      id: number
      start_frame_index: number
      end_frame_index: number
    }>

    // Calculate the merged gap range
    let mergedStart = start_frame_index
    let mergedEnd = end_frame_index

    const gapIdsToDelete: number[] = []

    for (const gap of adjacentGaps) {
      if (gap.end_frame_index === start_frame_index - 1) {
        // Gap is immediately before
        mergedStart = gap.start_frame_index
        gapIdsToDelete.push(gap.id)
      } else if (gap.start_frame_index === end_frame_index + 1) {
        // Gap is immediately after
        mergedEnd = gap.end_frame_index
        gapIdsToDelete.push(gap.id)
      }
    }

    // Delete the annotation and its combined image
    deleteCombinedImage(videoId, annotationId)
    db.prepare('DELETE FROM captions WHERE id = ?').run(annotationId)

    // Delete adjacent gaps (gaps don't have combined images, so no cleanup needed)
    for (const gapId of gapIdsToDelete) {
      db.prepare('DELETE FROM captions WHERE id = ?').run(gapId)
    }

    // Create merged gap annotation
    const result = db
      .prepare(
        `
      INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending)
      VALUES (?, ?, 'gap', 0)
    `
      )
      .run(mergedStart, mergedEnd)

    const mergedGap = db.prepare('SELECT * FROM captions WHERE id = ?').get(result.lastInsertRowid)

    db.close()

    return new Response(
      JSON.stringify({
        deleted: annotationId,
        mergedGap,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
