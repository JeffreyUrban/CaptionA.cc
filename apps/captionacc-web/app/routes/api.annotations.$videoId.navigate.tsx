import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface Annotation {
  id: number
  video_id: string
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

    // Get current annotation's updated_at
    const current = db.prepare('SELECT updated_at FROM annotations WHERE id = ?').get(currentId) as
      { updated_at: string } | undefined

    if (!current) {
      db.close()
      return new Response(JSON.stringify({ error: 'Current annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let annotation: Annotation | undefined

    if (direction === 'prev') {
      // Get annotation with most recent updated_at that's before current
      annotation = db.prepare(`
        SELECT * FROM annotations
        WHERE updated_at < ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(current.updated_at) as Annotation | undefined
    } else {
      // Get annotation with oldest updated_at that's after current
      annotation = db.prepare(`
        SELECT * FROM annotations
        WHERE updated_at > ?
        ORDER BY updated_at ASC
        LIMIT 1
      `).get(current.updated_at) as Annotation | undefined
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
