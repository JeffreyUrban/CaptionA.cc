/**
 * Delete a folder (and all its contents) from the video library
 */
import type { ActionFunctionArgs } from 'react-router'
import { resolve } from 'path'
import { rm, access, readdir } from 'fs/promises'
import { constants } from 'fs'

// Recursively count videos in a directory
async function countVideos(dir: string): Promise<number> {
  let count = 0

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    // Check if this directory has an annotations.db file (it's a video)
    const hasAnnotationsDb = entries.some(
      entry => entry.isFile() && entry.name === 'annotations.db'
    )

    if (hasAnnotationsDb) {
      return 1 // This directory is a video
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = resolve(dir, entry.name)
        count += await countVideos(fullPath)
      }
    }
  } catch (error) {
    console.error(`Error counting videos in ${dir}:`, error)
  }

  return count
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const url = new URL(request.url)
  const folderPath = url.searchParams.get('path')
  const confirmed = url.searchParams.get('confirmed') === 'true'

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

  // Count videos that will be deleted
  const videoCount = await countVideos(fullPath)

  // If not confirmed, return the count for user confirmation
  if (!confirmed) {
    return Response.json({
      requiresConfirmation: true,
      videoCount,
      folderPath
    })
  }

  // Delete the folder recursively
  try {
    await rm(fullPath, { recursive: true, force: true })
    return Response.json({
      success: true,
      folderPath,
      videosDeleted: videoCount
    })
  } catch (error) {
    console.error('Failed to delete folder:', error)
    return Response.json({ error: 'Failed to delete folder' }, { status: 500 })
  }
}
