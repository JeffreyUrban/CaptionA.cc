import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  state: 'predicted' | 'confirmed' | 'gap'
  pending: number
  text: string | null
  created_at: string
  updated_at: string
}

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

// GET - Fetch annotations in a range
export async function loader({ params, request }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params
  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const url = new URL(request.url)
  const startFrame = parseInt(url.searchParams.get('start') || '0')
  const endFrame = parseInt(url.searchParams.get('end') || '1000')

  try {
    const db = getDatabase(videoId)

    // Query annotations that overlap with the requested range
    const annotations = db.prepare(`
      SELECT * FROM annotations
      WHERE end_frame_index >= ? AND start_frame_index <= ?
      ORDER BY start_frame_index
    `).all(startFrame, endFrame) as Annotation[]

    db.close()

    return new Response(JSON.stringify({ annotations }), {
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

// POST - Create or update annotation with overlap resolution
export async function action({ params, request }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params
  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const body = await request.json()

  try {
    const db = getDatabase(videoId)

    if (request.method === 'PUT') {
      // Update existing annotation with overlap resolution
      const { id, start_frame_index, end_frame_index, state, pending } = body

      // Get the original annotation to check if range is being reduced
      const original = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Annotation

      // Find overlapping annotations (excluding the one being updated)
      const overlapping = db.prepare(`
        SELECT * FROM annotations
        WHERE id != ?
        AND NOT (end_frame_index < ? OR start_frame_index > ?)
      `).all(id, start_frame_index, end_frame_index) as Annotation[]

      // Resolve overlaps by adjusting conflicting annotations
      for (const overlap of overlapping) {
        if (overlap.start_frame_index >= start_frame_index && overlap.end_frame_index <= end_frame_index) {
          // Completely contained - delete it
          db.prepare('DELETE FROM annotations WHERE id = ?').run(overlap.id)
        } else if (overlap.start_frame_index < start_frame_index && overlap.end_frame_index > end_frame_index) {
          // New annotation is contained within existing - split the existing
          // Keep the left part, set to pending
          db.prepare(`
            UPDATE annotations
            SET end_frame_index = ?, pending = 1
            WHERE id = ?
          `).run(start_frame_index - 1, overlap.id)

          // Create right part as pending
          db.prepare(`
            INSERT INTO annotations (start_frame_index, end_frame_index, state, pending, text)
            VALUES (?, ?, ?, 1, ?)
          `).run(end_frame_index + 1, overlap.end_frame_index, overlap.state, overlap.text)
        } else if (overlap.start_frame_index < start_frame_index) {
          // Overlaps on the left - trim it
          db.prepare(`
            UPDATE annotations
            SET end_frame_index = ?, pending = 1
            WHERE id = ?
          `).run(start_frame_index - 1, overlap.id)
        } else {
          // Overlaps on the right - trim it
          db.prepare(`
            UPDATE annotations
            SET start_frame_index = ?, pending = 1
            WHERE id = ?
          `).run(end_frame_index + 1, overlap.id)
        }
      }

      // Helper function to create or merge gap annotation
      const createOrMergeGap = (gapStart: number, gapEnd: number) => {
        // Find adjacent gap annotations
        const adjacentGaps = db.prepare(`
          SELECT * FROM annotations
          WHERE state = 'gap'
          AND (
            end_frame_index = ? - 1
            OR start_frame_index = ? + 1
          )
          ORDER BY start_frame_index
        `).all(gapStart, gapEnd) as Annotation[]

        // Calculate merged gap range
        let mergedStart = gapStart
        let mergedEnd = gapEnd
        const gapIdsToDelete: number[] = []

        for (const gap of adjacentGaps) {
          if (gap.end_frame_index === gapStart - 1) {
            // Gap is immediately before
            mergedStart = gap.start_frame_index
            gapIdsToDelete.push(gap.id)
          } else if (gap.start_frame_index === gapEnd + 1) {
            // Gap is immediately after
            mergedEnd = gap.end_frame_index
            gapIdsToDelete.push(gap.id)
          }
        }

        // Delete adjacent gaps that will be merged
        for (const gapId of gapIdsToDelete) {
          db.prepare('DELETE FROM annotations WHERE id = ?').run(gapId)
        }

        // Create merged gap annotation
        db.prepare(`
          INSERT INTO annotations (start_frame_index, end_frame_index, state, pending)
          VALUES (?, ?, 'gap', 0)
        `).run(mergedStart, mergedEnd)
      }

      // Create gap annotations for uncovered ranges when annotation is reduced
      if (start_frame_index > original.start_frame_index) {
        // Create gap for the range before the new annotation
        createOrMergeGap(original.start_frame_index, start_frame_index - 1)
      }

      if (end_frame_index < original.end_frame_index) {
        // Create gap for the range after the new annotation
        createOrMergeGap(end_frame_index + 1, original.end_frame_index)
      }

      // Update the annotation and mark as confirmed
      db.prepare(`
        UPDATE annotations
        SET start_frame_index = ?,
            end_frame_index = ?,
            state = ?,
            pending = 0
        WHERE id = ?
      `).run(start_frame_index, end_frame_index, state || 'confirmed', id)

      const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id)
      db.close()

      return new Response(JSON.stringify({ annotation }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } else {
      // Create new annotation
      const { start_frame_index, end_frame_index, state, pending, text } = body

      const result = db.prepare(`
        INSERT INTO annotations (start_frame_index, end_frame_index, state, pending, text)
        VALUES (?, ?, ?, ?, ?)
      `).run(start_frame_index, end_frame_index, state, pending ? 1 : 0, text || null)

      const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(result.lastInsertRowid)
      db.close()

      return new Response(JSON.stringify({ annotation }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
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
