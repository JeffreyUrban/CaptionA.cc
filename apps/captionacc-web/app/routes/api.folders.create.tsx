/**
 * Create a new folder in the video library
 * Note: Folders are virtual - they exist as path prefixes in video display_path metadata.
 * Empty folders are tracked in a metadata file so they appear in the UI immediately.
 */
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

import type { ActionFunctionArgs } from 'react-router'

import { getAllVideos } from '~/utils/video-paths'

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

async function writeFoldersMetadata(metadata: FoldersMetadata): Promise<void> {
  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true })
  }
  await writeFile(foldersMetaPath, JSON.stringify(metadata, null, 2), 'utf-8')
}

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

  if (!/^[a-zA-Z0-9_\-/\s]+$/.test(trimmedPath)) {
    return Response.json({ error: 'Folder path contains invalid characters' }, { status: 400 })
  }

  // Check if a video or folder with this exact path already exists
  const allVideos = getAllVideos()
  const folderPrefix = trimmedPath + '/'

  // Check if this exact path is already used by a video
  const videoExists = allVideos.some(v => v.displayPath === trimmedPath)
  if (videoExists) {
    return Response.json({ error: 'A video with this name already exists' }, { status: 409 })
  }

  // Check if any videos already exist with this folder prefix (folder already exists)
  const folderExists = allVideos.some(
    v => v.displayPath.startsWith(folderPrefix) || v.displayPath === trimmedPath
  )
  if (folderExists) {
    return Response.json({ error: 'Folder already exists' }, { status: 409 })
  }

  // Check if already in empty folders list
  const metadata = await readFoldersMetadata()
  if (metadata.emptyFolders.includes(trimmedPath)) {
    return Response.json({ error: 'Folder already exists' }, { status: 409 })
  }

  // Add to empty folders list
  metadata.emptyFolders.push(trimmedPath)
  await writeFoldersMetadata(metadata)

  return Response.json(
    {
      success: true,
      folderPath: trimmedPath,
    },
    { status: 201 }
  )
}
