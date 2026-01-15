import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

async function getDatabase(videoId: string): Promise<Database.Database | Response> {
  const dbPath = await getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// POST - Clear all user annotations
export async function action({ params }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = await getDatabase(videoId)
    if (db instanceof Response) return db

    // Count annotations before deletion
    const countResult = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM full_frame_box_labels WHERE label_source = 'user'
    `
      )
      .get() as { count: number }

    const deletedCount = countResult.count

    // Delete all user annotations
    db.prepare(
      `
      DELETE FROM full_frame_box_labels WHERE label_source = 'user'
    `
    ).run()

    db.close()

    console.log(`[Clear All] Deleted ${deletedCount} user annotations for video: ${videoId}`)

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error clearing all annotations:', error)
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
