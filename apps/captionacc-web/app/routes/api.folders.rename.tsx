/**
 * Rename a folder in the video library
 * Updates display_path for all videos in the folder (storage paths are immutable UUIDs)
 */
import { resolve } from 'path'

import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getAllVideos } from '~/utils/video-paths'

const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

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

  if (!/^[a-zA-Z0-9_\-/\s]+$/.test(trimmedNewPath)) {
    return Response.json({ error: 'Folder path contains invalid characters' }, { status: 400 })
  }

  // Get all videos to find those in this folder
  const allVideos = await getAllVideos()

  // Find videos in the old folder path
  const oldPathPrefix = oldPath + '/'
  const videosInFolder = allVideos.filter(
    video => video.displayPath === oldPath || video.displayPath.startsWith(oldPathPrefix)
  )

  if (videosInFolder.length === 0) {
    return Response.json({ error: 'Folder does not exist or is empty' }, { status: 404 })
  }

  // Check if any video would conflict with existing paths in new location
  for (const video of videosInFolder) {
    // Calculate new display path for this video
    let newDisplayPath: string
    if (video.displayPath === oldPath) {
      newDisplayPath = trimmedNewPath
    } else {
      // Replace the old folder prefix with the new one
      newDisplayPath = trimmedNewPath + video.displayPath.substring(oldPath.length)
    }

    // Check if new path already exists
    const existingVideo = allVideos.find(v => v.displayPath === newDisplayPath)
    if (existingVideo) {
      return Response.json(
        { error: `Target path already exists: ${newDisplayPath}` },
        { status: 409 }
      )
    }
  }

  // Update all videos in the folder
  try {
    let updatedCount = 0

    for (const video of videosInFolder) {
      // Calculate new display path
      let newDisplayPath: string
      if (video.displayPath === oldPath) {
        newDisplayPath = trimmedNewPath
      } else {
        newDisplayPath = trimmedNewPath + video.displayPath.substring(oldPath.length)
      }

      // Get database path from storage path
      const { storagePath } = video
      const dbPath = resolve(dataDir, ...storagePath.split('/'), 'annotations.db')

      // Update display_path in database
      const db = new Database(dbPath)
      try {
        db.prepare(
          `
          UPDATE video_metadata
          SET display_path = ?
          WHERE id = 1
        `
        ).run(newDisplayPath)
        updatedCount++
      } finally {
        db.close()
      }
    }

    return Response.json({
      success: true,
      oldPath,
      newPath: trimmedNewPath,
      updatedVideos: updatedCount,
    })
  } catch (error) {
    console.error('Failed to rename folder:', error)
    return Response.json({ error: 'Failed to rename folder' }, { status: 500 })
  }
}
