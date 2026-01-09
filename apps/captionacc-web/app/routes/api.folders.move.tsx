/**
 * Move a virtual folder by updating display_path in video databases
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'
import type { ActionFunctionArgs } from 'react-router'

import { getAllVideos } from '~/utils/video-paths'

const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
const foldersMetaPath = resolve(dataDir, '.folders.json')

interface FoldersMetadata {
  emptyFolders: string[]
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await request.json()
  const { folderPath, targetFolder } = body

  if (!folderPath) {
    return Response.json({ error: 'folderPath is required' }, { status: 400 })
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

  // Extract folder name from current path
  const pathParts = folderPath.split('/')
  const folderName = pathParts[pathParts.length - 1]

  // Build new path
  const newPath = targetFolder ? `${targetFolder}/${folderName}` : folderName

  // Prevent moving a folder into itself or its descendants
  if (newPath.startsWith(`${folderPath}/`)) {
    return Response.json(
      { error: 'Cannot move a folder into itself or its descendants' },
      { status: 400 }
    )
  }

  // Prevent moving a folder to its current location
  if (folderPath === newPath) {
    return Response.json({ error: 'Folder is already in this location' }, { status: 400 })
  }

  // Find all videos in this folder (display_path starts with folderPath/)
  const allVideos = await getAllVideos()
  const videosToMove = allVideos.filter(
    v => v.displayPath.startsWith(`${folderPath}/`) || v.displayPath === folderPath
  )

  // Check if it's an empty folder in metadata
  let isEmptyFolder = false
  if (videosToMove.length === 0) {
    try {
      if (existsSync(foldersMetaPath)) {
        const content = readFileSync(foldersMetaPath, 'utf-8')
        const metadata: FoldersMetadata = JSON.parse(content)
        isEmptyFolder = metadata.emptyFolders.includes(folderPath)
      }
    } catch (error) {
      console.error('[FolderMove] Error reading folders metadata:', error)
    }

    if (!isEmptyFolder) {
      return Response.json({ error: 'Folder not found' }, { status: 404 })
    }
  }

  // Handle empty folder move
  if (isEmptyFolder) {
    try {
      const content = readFileSync(foldersMetaPath, 'utf-8')
      const metadata: FoldersMetadata = JSON.parse(content)

      // Remove old path and add new path
      metadata.emptyFolders = metadata.emptyFolders.filter(f => f !== folderPath)
      metadata.emptyFolders.push(newPath)

      writeFileSync(foldersMetaPath, JSON.stringify(metadata, null, 2), 'utf-8')

      console.log(`[FolderMove] Moved empty folder "${folderPath}" to "${newPath}"`)

      return Response.json({
        success: true,
        oldPath: folderPath,
        newPath,
        videosUpdated: 0,
        wasEmptyFolder: true,
      })
    } catch (error) {
      console.error('[FolderMove] Error moving empty folder:', error)
      return Response.json({ error: 'Failed to move folder' }, { status: 500 })
    }
  }

  console.log(
    `[FolderMove] Moving ${videosToMove.length} videos from "${folderPath}" to "${newPath}"`
  )

  const errors: string[] = []

  // Update display_path for each video
  for (const video of videosToMove) {
    const dbPath = resolve(dataDir, ...video.storagePath.split('/'), 'captions.db')

    if (!existsSync(dbPath)) {
      errors.push(`Database not found for ${video.displayPath}`)
      continue
    }

    try {
      const db = new Database(dbPath)
      try {
        // Calculate new display_path
        let newDisplayPath: string
        if (video.displayPath === folderPath) {
          // Moving the folder itself (edge case)
          newDisplayPath = newPath
        } else {
          // Replace the folder prefix
          newDisplayPath = video.displayPath.replace(`${folderPath}/`, `${newPath}/`)
        }

        console.log(`[FolderMove] Updating ${video.displayPath} -> ${newDisplayPath}`)

        // Update display_path in database
        db.prepare(
          `
          UPDATE video_metadata
          SET display_path = ?
          WHERE id = 1
        `
        ).run(newDisplayPath)
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`Failed to update ${video.displayPath}:`, error)
      errors.push(`Failed to update ${video.displayPath}`)
    }
  }

  if (errors.length > 0) {
    return Response.json(
      {
        error: 'Failed to move some videos',
        details: errors,
      },
      { status: 500 }
    )
  }

  return Response.json({
    success: true,
    oldPath: folderPath,
    newPath,
    videosUpdated: videosToMove.length,
  })
}
