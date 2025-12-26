/**
 * Rename a folder in the video library
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
  const { oldPath, newPath } = body

  if (!oldPath || !newPath) {
    return Response.json({ error: 'oldPath and newPath are required' }, { status: 400 })
  }

  // Validate new path
  const trimmedNewPath = newPath.trim()
  if (trimmedNewPath.startsWith('/') || trimmedNewPath.endsWith('/')) {
    return Response.json({ error: 'Folder path should not start or end with /' }, { status: 400 })
  }

  if (!/^[a-zA-Z0-9_\-\/\s]+$/.test(trimmedNewPath)) {
    return Response.json({ error: 'Folder path contains invalid characters' }, { status: 400 })
  }

  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
  const oldFullPath = resolve(dataDir, oldPath)
  const newFullPath = resolve(dataDir, trimmedNewPath)

  // Check if old folder exists
  try {
    await access(oldFullPath, constants.F_OK)
  } catch {
    return Response.json({ error: 'Source folder does not exist' }, { status: 404 })
  }

  // Check if new path already exists
  try {
    await access(newFullPath, constants.F_OK)
    return Response.json({ error: 'Target folder already exists' }, { status: 409 })
  } catch {
    // Good - target doesn't exist
  }

  // Verify it's a directory, not a video directory (has annotations.db)
  try {
    const entries = await readdir(oldFullPath)
    if (entries.includes('annotations.db')) {
      return Response.json({
        error: 'Cannot rename video directory directly. This is a video, not a folder.'
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Failed to read directory:', error)
    return Response.json({ error: 'Failed to read source folder' }, { status: 500 })
  }

  // Rename the folder
  try {
    await rename(oldFullPath, newFullPath)
    return Response.json({ success: true, oldPath, newPath: trimmedNewPath })
  } catch (error) {
    console.error('Failed to rename folder:', error)
    return Response.json({ error: 'Failed to rename folder' }, { status: 500 })
  }
}
