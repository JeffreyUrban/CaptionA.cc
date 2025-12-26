/**
 * Delete an empty folder from the video library
 */
import type { ActionFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { rmdir, access, readdir } from 'fs/promises'
import { constants } from 'fs'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const url = new URL(request.url)
  const folderPath = url.searchParams.get('path')

  if (!folderPath) {
    return Response.json({ error: 'path parameter is required' }, { status: 400 })
  }

  const fullPath = resolve(process.cwd(), '..', '..', 'local', 'data', folderPath)

  // Check if folder exists
  try {
    await access(fullPath, constants.F_OK)
  } catch {
    return Response.json({ error: 'Folder does not exist' }, { status: 404 })
  }

  // Check if folder is empty
  try {
    const entries = await readdir(fullPath)
    if (entries.length > 0) {
      return Response.json({
        error: `Folder is not empty (contains ${entries.length} items)`,
        itemCount: entries.length
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Failed to read directory:', error)
    return Response.json({ error: 'Failed to read folder' }, { status: 500 })
  }

  // Delete the folder
  try {
    await rmdir(fullPath)
    return Response.json({ success: true, folderPath })
  } catch (error) {
    console.error('Failed to delete folder:', error)
    return Response.json({ error: 'Failed to delete folder' }, { status: 500 })
  }
}
