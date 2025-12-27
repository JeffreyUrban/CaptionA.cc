import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface TextQueueAnnotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  text: string | null
  text_pending: number
  text_status: string | null
  created_at: string
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

// GET - Fetch annotations needing text annotation
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params
  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = getDatabase(videoId)

    // Find annotations that need text annotation:
    // - text IS NULL (not yet annotated), OR
    // - text_pending = 1 (boundaries changed, needs re-annotation)
    // Exclude gaps
    // Order by start_frame_index
    const annotations = db.prepare(`
      SELECT
        id,
        start_frame_index,
        end_frame_index,
        boundary_state,
        text,
        text_pending,
        text_status,
        created_at
      FROM captions
      WHERE (text IS NULL OR text_pending = 1)
        AND boundary_state != 'gap'
      ORDER BY start_frame_index ASC
    `).all() as TextQueueAnnotation[]

    db.close()

    return new Response(JSON.stringify({
      annotations,
      count: annotations.length
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
