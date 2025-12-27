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

// GET - Navigate to previous or next annotation by updated_at time
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
  const direction = url.searchParams.get('direction') // 'prev' or 'next'
  const currentId = parseInt(url.searchParams.get('currentId') || '0')

  if (!direction || !['prev', 'next'].includes(direction)) {
    return new Response(JSON.stringify({ error: 'Invalid direction' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const db = getDatabase(videoId)

    // Get current annotation's boundary_updated_at for comparison
    const current = db.prepare('SELECT boundary_updated_at FROM captions WHERE id = ?').get(currentId) as
      { boundary_updated_at: string } | undefined

    if (!current) {
      db.close()
      return new Response(JSON.stringify({ error: 'Current annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let annotation: Annotation | undefined

    if (direction === 'prev') {
      // Get previous non-gap annotation (earlier boundary_updated_at, or same boundary_updated_at with lower id)
      annotation = db.prepare(`
        SELECT * FROM captions
        WHERE (boundary_updated_at < ? OR (boundary_updated_at = ? AND id < ?))
        AND boundary_state IN ('predicted', 'confirmed')
        ORDER BY boundary_updated_at DESC, id DESC
        LIMIT 1
      `).get(current.boundary_updated_at, current.boundary_updated_at, currentId) as Annotation | undefined
    } else {
      // Get next non-gap annotation (later boundary_updated_at, or same boundary_updated_at with higher id)
      annotation = db.prepare(`
        SELECT * FROM captions
        WHERE (boundary_updated_at > ? OR (boundary_updated_at = ? AND id > ?))
        AND boundary_state IN ('predicted', 'confirmed')
        ORDER BY boundary_updated_at ASC, id ASC
        LIMIT 1
      `).get(current.boundary_updated_at, current.boundary_updated_at, currentId) as Annotation | undefined
    }

    db.close()

    if (!annotation) {
      return new Response(JSON.stringify({ annotation: null }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ annotation }), {
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
