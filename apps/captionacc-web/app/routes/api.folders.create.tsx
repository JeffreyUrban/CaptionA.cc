/**
 * Create a new folder in the video library
 */
import type { ActionFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { mkdir, access } from 'fs/promises'
import { constants } from 'fs'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await request.json()
  const { folderPath } = body

  if (!folderPath || typeof folderPath !== 'string') {
    return Response.json({ error: 'folderPath is required' }, { status: 400 })
  }

  // Validate folder path - no leading/trailing slashes, no special chars
  const trimmedPath = folderPath.trim()
  if (trimmedPath.startsWith('/') || trimmedPath.endsWith('/')) {
    return Response.json({ error: 'Folder path should not start or end with /' }, { status: 400 })
  }

  if (!/^[a-zA-Z0-9_\-\/\s]+$/.test(trimmedPath)) {
    return Response.json({ error: 'Folder path contains invalid characters' }, { status: 400 })
  }

  const fullPath = resolve(process.cwd(), '..', '..', 'local', 'data', trimmedPath)

  // Check if folder already exists
  try {
    await access(fullPath, constants.F_OK)
    return Response.json({ error: 'Folder already exists' }, { status: 409 })
  } catch {
    // Folder doesn't exist - good, we can create it
  }

  // Create the folder
  try {
    await mkdir(fullPath, { recursive: true })
    return Response.json({ success: true, folderPath: trimmedPath }, { status: 201 })
  } catch (error) {
    console.error('Failed to create folder:', error)
    return Response.json({ error: 'Failed to create folder' }, { status: 500 })
  }
}
