import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

function getDatabase(videoId: string): Database.Database | Response {
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
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const body = await request.json()
    const { complete } = body as { complete: boolean }

    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Ensure video_preferences row exists
    db.prepare(
      `
      INSERT OR IGNORE INTO video_preferences (id, layout_approved)
      VALUES (1, 0)
    `
    ).run()

    // Update layout_approved flag
    db.prepare(
      `
      UPDATE video_preferences
      SET layout_approved = ?,
          updated_at = datetime('now')
      WHERE id = 1
    `
    ).run(complete ? 1 : 0)

    db.close()

    // Mark video as touched for UI refresh
    // Layout approval is a significant state change that should update the video list
    const response = new Response(
      JSON.stringify({
        success: true,
        layoutApproved: complete,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Video-Touched': videoId, // Signal client to mark as touched
        },
      }
    )

    return response
  } catch (error) {
    console.error('Error updating layout approved status:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
