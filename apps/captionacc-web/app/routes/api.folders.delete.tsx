/**
 * Delete a folder (and all its contents) from the video library
 *
 * With UUID-based storage, folders are virtual (based on display_path prefixes).
 * This endpoint finds all videos with display_path starting with the folder path
 * and deletes their UUID directories.
 */
import { rm } from 'fs/promises'
import { resolve } from 'path'

import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getAllVideos, getDbPath } from '~/utils/video-paths'

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

  // Find all videos in this folder (videos whose display_path starts with folderPath)
  const allVideos = getAllVideos()
  const normalizedFolderPath = folderPath.replace(/\/$/, '') // Remove trailing slash
  const videosToDelete = allVideos.filter(video => {
    // Match exact folder or videos in subfolders
    return (
      video.displayPath === normalizedFolderPath ||
      video.displayPath.startsWith(normalizedFolderPath + '/')
    )
  })

  const videoCount = videosToDelete.length

  // If folder doesn't exist (no videos found), return 404
  if (videoCount === 0) {
    return Response.json({ error: 'Folder does not exist or is empty' }, { status: 404 })
  }

  // If not confirmed, return the count for user confirmation
  if (!confirmed) {
    return Response.json({
      requiresConfirmation: true,
      videoCount,
      folderPath,
    })
  }

  // Delete each video's UUID directory
  let deletedCount = 0
  const errors: string[] = []

  for (const video of videosToDelete) {
    try {
      // Get database path
      const dbPath = getDbPath(video.videoId)

      if (dbPath) {
        // Mark as deleted in database first
        const db = new Database(dbPath)
        try {
          db.prepare(
            `
            UPDATE processing_status
            SET deleted = 1,
                deleted_at = datetime('now')
            WHERE id = 1
          `
          ).run()
        } finally {
          db.close()
        }
      }

      // Delete the UUID directory
      const videoDir = resolve(
        process.cwd(),
        '..',
        '..',
        'local',
        'data',
        ...video.storagePath.split('/')
      )
      await rm(videoDir, { recursive: true, force: true })
      deletedCount++

      console.log(`[FolderDelete] Deleted video: ${video.displayPath} (${video.storagePath})`)
    } catch (error) {
      console.error(`[FolderDelete] Failed to delete ${video.displayPath}:`, error)
      errors.push(
        `${video.displayPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  if (errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: 'Some videos failed to delete',
        deletedCount,
        errors,
      },
      { status: 500 }
    )
  }

  return Response.json({
    success: true,
    folderPath,
    videosDeleted: deletedCount,
  })
}
