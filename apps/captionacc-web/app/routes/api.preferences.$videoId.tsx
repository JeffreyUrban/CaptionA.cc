import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface VideoPreferences {
  text_size: number
  padding_scale: number
  text_anchor: 'left' | 'center' | 'right'
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
    const prefs = db.prepare('SELECT text_size, padding_scale, text_anchor FROM video_preferences WHERE id = 1').get() as VideoPreferences | undefined

    db.close()

    if (!prefs) {
      // Return default if not found (3% of image width, 0.75em padding, left anchor)
      return Response.json({ text_size: 3.0, padding_scale: 0.75, text_anchor: 'left' })
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
    const { text_size, padding_scale, text_anchor } = body

    // Validate text_size is a number between 1.0 and 10.0 (percentage of image width)
    if (text_size !== undefined && (typeof text_size !== 'number' || text_size < 1.0 || text_size > 10.0)) {
      return new Response(JSON.stringify({ error: 'Invalid text_size (must be number between 1.0 and 10.0)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Validate padding_scale is a number between 0.0 and 2.0
    if (padding_scale !== undefined && (typeof padding_scale !== 'number' || padding_scale < 0.0 || padding_scale > 2.0)) {
      return new Response(JSON.stringify({ error: 'Invalid padding_scale (must be number between 0.0 and 2.0)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Validate text_anchor is one of the allowed values
    if (text_anchor !== undefined && !['left', 'center', 'right'].includes(text_anchor)) {
      return new Response(JSON.stringify({ error: 'Invalid text_anchor (must be "left", "center", or "right")' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const db = getDatabase(videoId)

    // Build update query dynamically based on which fields are provided
    const updates: string[] = []
    const values: (number | string)[] = []

    if (text_size !== undefined) {
      updates.push('text_size = ?')
      values.push(text_size)
    }

    if (padding_scale !== undefined) {
      updates.push('padding_scale = ?')
      values.push(padding_scale)
    }

    if (text_anchor !== undefined) {
      updates.push('text_anchor = ?')
      values.push(text_anchor)
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime(\'now\')')
      db.prepare(`
        UPDATE video_preferences
        SET ${updates.join(', ')}
        WHERE id = 1
      `).run(...values)
    }

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
