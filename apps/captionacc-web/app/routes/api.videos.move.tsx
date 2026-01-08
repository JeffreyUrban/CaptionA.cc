/**
 * Move a video to a different folder by updating its display_path
 */
import { existsSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getVideoMetadata, getAllVideos } from '~/utils/video-paths'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await request.json()
  const { videoPath, targetFolder } = body

  if (!videoPath) {
    return Response.json({ error: 'videoPath is required' }, { status: 400 })
  }

  // targetFolder can be empty string (root folder)
  if (targetFolder === undefined || targetFolder === null) {
    return Response.json(
      { error: 'targetFolder is required (use empty string for root)' },
      { status: 400 }
    )
  }

  // Validate target folder path if not empty
  if (targetFolder) {
    const trimmedTargetFolder = targetFolder.trim()
    if (trimmedTargetFolder.startsWith('/') || trimmedTargetFolder.endsWith('/')) {
      return Response.json(
        { error: 'Target folder should not start or end with /' },
        { status: 400 }
      )
    }

    if (!/^[a-zA-Z0-9_\-/\s]+$/.test(trimmedTargetFolder)) {
      return Response.json({ error: 'Target folder contains invalid characters' }, { status: 400 })
    }
  }

  // Get video metadata
  const metadata = await getVideoMetadata(videoPath)
  if (!metadata) {
    return Response.json({ error: 'Video not found' }, { status: 404 })
  }

  // Extract video name from current display_path
  const pathParts = metadata.displayPath.split('/')
  const videoName = pathParts[pathParts.length - 1]

  // Build new display_path
  const newPath = targetFolder ? `${targetFolder}/${videoName}` : videoName

  // Prevent moving to current location
  if (metadata.displayPath === newPath) {
    return Response.json({ error: 'Video is already in this location' }, { status: 400 })
  }

  // Check for name conflict in target folder
  const allVideos = await getAllVideos()
  const conflictingVideo = allVideos.find(
    v => v.displayPath === newPath && v.storagePath !== metadata.storagePath
  )

  if (conflictingVideo) {
    return Response.json(
      {
        error: `A video named "${videoName}" already exists in ${targetFolder ? `folder "${targetFolder}"` : 'the root folder'}`,
      },
      { status: 409 }
    )
  }

  console.log(`[VideoMove] Moving "${metadata.displayPath}" to "${newPath}"`)

  // Update display_path in database
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
  const dbPath = resolve(dataDir, ...metadata.storagePath.split('/'), 'annotations.db')

  if (!existsSync(dbPath)) {
    return Response.json({ error: 'Video database not found' }, { status: 500 })
  }

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

      console.log(`[VideoMove] Updated display_path: ${metadata.displayPath} -> ${newPath}`)
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[VideoMove] Failed to update database:', error)
    return Response.json({ error: 'Failed to update video' }, { status: 500 })
  }

  return Response.json({
    success: true,
    oldPath: metadata.displayPath,
    newPath,
  })
}
