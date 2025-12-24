import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  boundary_pending: number
  boundary_updated_at: string
  text: string | null
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

// GET - Find next pending or gap annotation
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

    // Find the next pending or gap annotation with lowest start_frame_index
    // Pending annotations take priority over gaps
    const annotation = db.prepare(`
      SELECT * FROM annotations
      WHERE boundary_pending = 1 OR boundary_state = 'gap'
      ORDER BY boundary_pending DESC, start_frame_index ASC
      LIMIT 1
    `).get() as Annotation | undefined

    db.close()

    if (!annotation) {
      // No pending or gap annotations - workflow is complete!
      return new Response(JSON.stringify({ annotation: null, complete: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ annotation, complete: false }), {
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
