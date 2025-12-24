import { type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

function getDatabase(videoId: string) {
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )

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
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const annotationId = parseInt(id)

  try {
    const db = getDatabase(videoId)

    // Get the annotation to delete
    const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(annotationId) as {
      id: number
      start_frame_index: number
      end_frame_index: number
    } | undefined

    if (!annotation) {
      db.close()
      return new Response(JSON.stringify({ error: 'Annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const { start_frame_index, end_frame_index } = annotation

    // Find adjacent gap annotations
    const adjacentGaps = db.prepare(`
      SELECT * FROM annotations
      WHERE boundary_state = 'gap'
      AND (
        end_frame_index = ? - 1
        OR start_frame_index = ? + 1
      )
      ORDER BY start_frame_index
    `).all(start_frame_index, end_frame_index) as Array<{
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

    // Delete the annotation and adjacent gaps
    db.prepare('DELETE FROM annotations WHERE id = ?').run(annotationId)

    for (const gapId of gapIdsToDelete) {
      db.prepare('DELETE FROM annotations WHERE id = ?').run(gapId)
    }

    // Create merged gap annotation
    const result = db.prepare(`
      INSERT INTO annotations (start_frame_index, end_frame_index, boundary_state, boundary_pending)
      VALUES (?, ?, 'gap', 0)
    `).run(mergedStart, mergedEnd)

    const mergedGap = db.prepare('SELECT * FROM annotations WHERE id = ?').get(result.lastInsertRowid)

    db.close()

    return new Response(JSON.stringify({
      deleted: annotationId,
      mergedGap
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
