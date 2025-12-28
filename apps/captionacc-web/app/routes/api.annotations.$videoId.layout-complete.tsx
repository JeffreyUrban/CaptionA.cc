import { type ActionFunctionArgs } from 'react-router'
import { getDbPath } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'

function getDatabase(videoId: string) {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// POST - Mark layout annotation as approved
export async function action({ params, request }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const body = await request.json()
    const { complete } = body as { complete: boolean }

    const db = getDatabase(videoId)

    // Ensure video_preferences row exists
    db.prepare(`
      INSERT OR IGNORE INTO video_preferences (id, layout_approved)
      VALUES (1, 0)
    `).run()

    // Update layout_approved flag
    db.prepare(`
      UPDATE video_preferences
      SET layout_approved = ?,
          updated_at = datetime('now')
      WHERE id = 1
    `).run(complete ? 1 : 0)

    db.close()

    return new Response(JSON.stringify({
      success: true,
      layoutApproved: complete
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error updating layout approved status:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
