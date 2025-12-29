import { type LoaderFunctionArgs } from 'react-router'
import { getDbPath } from '~/utils/video-paths'
import Database from 'better-sqlite3'

export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, frameIndex } = params

  if (!encodedVideoId || !frameIndex) {
    return new Response('Missing videoId or frameIndex', { status: 400 })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  // Parse frame index
  const frameIdx = parseInt(frameIndex, 10)
  if (isNaN(frameIdx)) {
    return new Response('Invalid frameIndex', { status: 400 })
  }

  // Construct path to annotations.db
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  // Query database for frame
  const db = new Database(dbPath, { readonly: true })

  try {
    const stmt = db.prepare(`
      SELECT image_data
      FROM full_frames
      WHERE frame_index = ?
    `)

    const row = stmt.get(frameIdx) as { image_data: Buffer } | undefined

    if (!row) {
      return new Response(`Frame ${frameIndex} not found`, { status: 404 })
    }

    return new Response(row.image_data as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } finally {
    db.close()
  }
}
