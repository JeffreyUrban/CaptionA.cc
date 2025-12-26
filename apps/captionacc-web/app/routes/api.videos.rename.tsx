/**
 * Rename a video in the video library
 */
import type { ActionFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { rename, access, readdir } from 'fs/promises'
import { constants } from 'fs'

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

  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
  const oldFullPath = resolve(dataDir, oldPath)

  // Calculate new path (same parent directory, new name)
  const pathParts = oldPath.split('/')
  pathParts[pathParts.length - 1] = trimmedNewName
  const newPath = pathParts.join('/')
  const newFullPath = resolve(dataDir, newPath)

  // Check if old video exists
  try {
    await access(oldFullPath, constants.F_OK)
  } catch {
    return Response.json({ error: 'Video does not exist' }, { status: 404 })
  }

  // Verify it's a video directory (has annotations.db)
  try {
    const entries = await readdir(oldFullPath)
    if (!entries.includes('annotations.db')) {
      return Response.json({
        error: 'Not a video directory. This appears to be a folder.'
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Failed to read directory:', error)
    return Response.json({ error: 'Failed to read video directory' }, { status: 500 })
  }

  // Check if new path already exists
  try {
    await access(newFullPath, constants.F_OK)
    return Response.json({ error: 'A video or folder with this name already exists' }, { status: 409 })
  } catch {
    // Good - target doesn't exist
  }

  // Rename the video directory
  try {
    await rename(oldFullPath, newFullPath)
    return Response.json({ success: true, oldPath, newPath })
  } catch (error) {
    console.error('Failed to rename video:', error)
    return Response.json({ error: 'Failed to rename video' }, { status: 500 })
  }
}
