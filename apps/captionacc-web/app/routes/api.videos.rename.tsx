/**
 * Rename a video in the video library
 * Updates the display_path in the database (storage paths are immutable UUIDs)
 */
import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getDbPath, resolveDisplayPath } from '~/utils/video-paths'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await request.json()
  const { oldPath, newName } = body

  if (!oldPath || !newName) {
    return Response.json({ error: 'oldPath and newName are required' }, { status: 400 })
  }

  // Validate new name
  const trimmedNewName = newName.trim()
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedNewName)) {
    return Response.json({ error: 'Video name contains invalid characters' }, { status: 400 })
  }

  // Calculate new display path (same parent directory, new name)
  const pathParts = oldPath.split('/')
  pathParts[pathParts.length - 1] = trimmedNewName
  const newPath = pathParts.join('/')

  // Check if old video exists by resolving its display path
  const dbPath = await getDbPath(oldPath)
  if (!dbPath) {
    return Response.json({ error: 'Video does not exist' }, { status: 404 })
  }

  // Check if new path already exists
  const existingNewPath = await resolveDisplayPath(newPath)
  if (existingNewPath) {
    return Response.json({ error: 'A video with this name already exists' }, { status: 409 })
  }

  // Update the display_path in the database
  try {
    const db = new Database(dbPath)
    try {
      db.prepare(
        `
        UPDATE video_metadata
        SET display_path = ?
        WHERE id = 1
      `
      ).run(newPath)

      return Response.json({ success: true, oldPath, newPath })
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('Failed to rename video:', error)
    return Response.json({ error: 'Failed to rename video' }, { status: 500 })
  }
}
