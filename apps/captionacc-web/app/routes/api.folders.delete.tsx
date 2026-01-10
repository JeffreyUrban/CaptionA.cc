/**
 * Delete a folder (and all its contents) from the video library
 *
 * With UUID-based storage, folders are virtual (based on display_path prefixes).
 * This endpoint finds all videos with display_path starting with the folder path
 * and deletes their UUID directories.
 */
import { existsSync } from 'fs'
import { rm, readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getAllVideos, getCaptionsDbPath } from '~/utils/video-paths'

const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
const foldersMetaPath = resolve(dataDir, '.folders.json')

interface FoldersMetadata {
  emptyFolders: string[]
}

async function readFoldersMetadata(): Promise<FoldersMetadata> {
  try {
    if (existsSync(foldersMetaPath)) {
      const content = await readFile(foldersMetaPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch {
    // If file doesn't exist or is invalid, return empty
  }
  return { emptyFolders: [] }
}

async function removeFromEmptyFolders(folderPath: string): Promise<boolean> {
  try {
    if (existsSync(foldersMetaPath)) {
      const content = await readFile(foldersMetaPath, 'utf-8')
      const metadata: FoldersMetadata = JSON.parse(content)
      const before = metadata.emptyFolders.length
      metadata.emptyFolders = metadata.emptyFolders.filter(f => f !== folderPath)
      const after = metadata.emptyFolders.length

      if (before > after) {
        await writeFile(foldersMetaPath, JSON.stringify(metadata, null, 2), 'utf-8')
        console.log(`[FolderDelete] Removed "${folderPath}" from empty folders metadata`)
        return true
      } else {
        console.log(`[FolderDelete] Folder "${folderPath}" not found in empty folders metadata`)
        return false
      }
    } else {
      console.log('[FolderDelete] Empty folders metadata file does not exist')
      return false
    }
  } catch (error) {
    console.error('[FolderDelete] Error removing from empty folders:', error)
    return false
  }
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

  // Find all videos in this folder (videos whose display_path starts with folderPath)
  const allVideos = await getAllVideos()
  const normalizedFolderPath = folderPath.replace(/\/$/, '') // Remove trailing slash
  const videosToDelete = allVideos.filter(video => {
    // Match exact folder or videos in subfolders
    return (
      video.displayPath === normalizedFolderPath ||
      video.displayPath.startsWith(normalizedFolderPath + '/')
    )
  })

  const videoCount = videosToDelete.length

  // Check if it's an empty folder (exists in metadata but has no videos)
  let isEmptyFolder = false
  if (videoCount === 0) {
    // Check if folder exists in empty folders metadata
    const metadata = await readFoldersMetadata()
    isEmptyFolder = metadata.emptyFolders.includes(normalizedFolderPath)

    if (!isEmptyFolder) {
      return Response.json({ error: 'Folder not found' }, { status: 404 })
    }
  }

  // If not confirmed, return the count for user confirmation
  if (!confirmed) {
    return Response.json({
      requiresConfirmation: true,
      videoCount,
      folderPath,
    })
  }

  // Delete empty folder if applicable
  if (isEmptyFolder) {
    const removed = await removeFromEmptyFolders(normalizedFolderPath)
    if (!removed) {
      return Response.json({ error: 'Failed to delete folder' }, { status: 500 })
    }
    return Response.json({
      success: true,
      folderPath: normalizedFolderPath,
      videosDeleted: 0,
      wasEmptyFolder: true,
    })
  }

  // Delete each video's UUID directory
  let deletedCount = 0
  const errors: string[] = []

  for (const video of videosToDelete) {
    try {
      // Get database path
      const dbPath = await getCaptionsDbPath(video.videoId)

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

  // Clean up from empty folders metadata
  await removeFromEmptyFolders(normalizedFolderPath)

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
