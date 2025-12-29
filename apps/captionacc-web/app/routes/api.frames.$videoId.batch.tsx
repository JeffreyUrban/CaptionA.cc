import Database from 'better-sqlite3'
import { type LoaderFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response('Missing videoId', { status: 400 })
  }

  // Parse frame indices from query string
  const url = new URL(request.url)
  const indicesParam = url.searchParams.get('indices')

  if (!indicesParam) {
    return new Response('Missing indices parameter', { status: 400 })
  }

  // Parse comma-separated indices
  const indices = indicesParam.split(',').map(idx => parseInt(idx.trim(), 10))

  if (indices.some(idx => isNaN(idx))) {
    return new Response('Invalid frame indices', { status: 400 })
  }

  // Decode the URL-encoded videoId
  const videoId = decodeURIComponent(encodedVideoId)

  // Construct path to annotations.db
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  // Query database for frames
  const db = new Database(dbPath, { readonly: true })

  try {
    // Build placeholders for SQL IN clause
    const placeholders = indices.map(() => '?').join(',')

    const stmt = db.prepare(`
      SELECT frame_index, image_data, width, height, file_size
      FROM cropped_frames
      WHERE frame_index IN (${placeholders})
      ORDER BY frame_index
    `)

    const rows = stmt.all(...indices) as Array<{
      frame_index: number
      image_data: Buffer
      width: number
      height: number
      file_size: number
    }>

    // Convert to JSON response with base64-encoded images
    const frames = rows.map(row => ({
      frame_index: row.frame_index,
      image_data: row.image_data.toString('base64'),
      width: row.width,
      height: row.height,
      file_size: row.file_size,
    }))

    return new Response(JSON.stringify({ frames }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } finally {
    db.close()
  }
}
