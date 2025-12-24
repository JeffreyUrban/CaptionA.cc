import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface VideoPreferences {
  text_size: number
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

// GET - Fetch video preferences
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
    const prefs = db.prepare('SELECT text_size FROM video_preferences WHERE id = 1').get() as VideoPreferences | undefined

    db.close()

    if (!prefs) {
      // Return default if not found (3% of image width)
      return Response.json({ text_size: 3.0 })
    }

    return Response.json(prefs)
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

// PUT - Update video preferences
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
    const { text_size } = body

    // Validate text_size is a number between 1.0 and 10.0 (percentage of image width)
    if (typeof text_size !== 'number' || text_size < 1.0 || text_size > 10.0) {
      return new Response(JSON.stringify({ error: 'Invalid text_size (must be number between 1.0 and 10.0)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const db = getDatabase(videoId)

    db.prepare(`
      UPDATE video_preferences
      SET text_size = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(text_size)

    db.close()

    return Response.json({ success: true })
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
