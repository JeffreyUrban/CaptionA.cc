import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

interface VideoPreferences {
  text_size: number
  padding_scale: number
  text_anchor: 'left' | 'center' | 'right'
}

function getDatabase(videoId: string): { db: Database.Database; path: string } | Response {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return { db: new Database(dbPath), path: dbPath }
}

// GET - Fetch video preferences
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const result = getDatabase(videoId)
    if (result instanceof Response) return result
    const { db, path: dbPath } = result

    // Check if video_preferences table exists and has required columns
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('video_preferences')")
      .all() as Array<{ name: string }>
    const columnNames = new Set(columns.map(c => c.name))

    const hasTextSize = columnNames.has('text_size')
    const hasPaddingScale = columnNames.has('padding_scale')
    const hasTextAnchor = columnNames.has('text_anchor')

    // Detect schema issues and fix them by running migrations
    if (!hasTextSize || !hasPaddingScale || !hasTextAnchor) {
      console.error(
        `[Preferences] Schema mismatch for ${videoId}: text_size=${hasTextSize}, padding_scale=${hasPaddingScale}, text_anchor=${hasTextAnchor}`
      )
      console.error('[Preferences] Attempting to fix by running migrations...')

      try {
        // Import and run migrations
        db.close()

        const { migrateDatabase } = await import('~/db/migrate')
        migrateDatabase(dbPath)

        // Reopen database and try again
        const result2 = getDatabase(videoId)
        if (result2 instanceof Response) return result2
        const { db: db2 } = result2

        const prefs = db2
          .prepare(
            'SELECT text_size, padding_scale, text_anchor FROM video_preferences WHERE id = 1'
          )
          .get() as VideoPreferences | undefined

        db2.close()

        if (!prefs) {
          return Response.json({ text_size: 3.0, padding_scale: 0.75, text_anchor: 'left' })
        }

        console.log(`[Preferences] Successfully fixed schema for ${videoId}`)
        return Response.json(prefs)
      } catch (migrationError) {
        console.error('[Preferences] Failed to fix schema:', migrationError)
        return new Response(
          JSON.stringify({
            error: 'Database schema is outdated. Please contact support.',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    }

    const prefs = db
      .prepare('SELECT text_size, padding_scale, text_anchor FROM video_preferences WHERE id = 1')
      .get() as VideoPreferences | undefined

    db.close()

    if (!prefs) {
      // Return default if not found (3% of image width, 0.75em padding, left anchor)
      return Response.json({ text_size: 3.0, padding_scale: 0.75, text_anchor: 'left' })
    }

    return Response.json(prefs)
  } catch (error) {
    console.error(`[Preferences] Error loading preferences for ${videoId}:`, error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// PUT - Update video preferences
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
    const { text_size, padding_scale, text_anchor } = body

    // Validate text_size is a number between 1.0 and 10.0 (percentage of image width)
    if (
      text_size !== undefined &&
      (typeof text_size !== 'number' || text_size < 1.0 || text_size > 10.0)
    ) {
      return new Response(
        JSON.stringify({ error: 'Invalid text_size (must be number between 1.0 and 10.0)' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Validate padding_scale is a number between 0.0 and 2.0
    if (
      padding_scale !== undefined &&
      (typeof padding_scale !== 'number' || padding_scale < 0.0 || padding_scale > 2.0)
    ) {
      return new Response(
        JSON.stringify({ error: 'Invalid padding_scale (must be number between 0.0 and 2.0)' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Validate text_anchor is one of the allowed values
    if (text_anchor !== undefined && !['left', 'center', 'right'].includes(text_anchor)) {
      return new Response(
        JSON.stringify({ error: 'Invalid text_anchor (must be "left", "center", or "right")' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const result = getDatabase(videoId)
    if (result instanceof Response) return result
    const { db, path: dbPath } = result

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
      updates.push("updated_at = datetime('now')")

      try {
        db.prepare(
          `
          UPDATE video_preferences
          SET ${updates.join(', ')}
          WHERE id = 1
        `
        ).run(...values)
      } catch (_updateError) {
        // If update fails (likely due to missing columns), try running migrations
        console.error(`[Preferences] Update failed for ${videoId}, attempting migrations...`)
        db.close()

        const { migrateDatabase } = await import('~/db/migrate')
        migrateDatabase(dbPath)

        // Retry the update
        const result2 = getDatabase(videoId)
        if (result2 instanceof Response) return result2
        const { db: db2 } = result2

        db2
          .prepare(
            `
          UPDATE video_preferences
          SET ${updates.join(', ')}
          WHERE id = 1
        `
          )
          .run(...values)
        db2.close()

        console.log(`[Preferences] Successfully fixed schema and updated ${videoId}`)
        return Response.json({ success: true })
      }
    }

    db.close()

    return Response.json({ success: true })
  } catch (error) {
    console.error(`[Preferences] Error updating preferences for ${videoId}:`, error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
