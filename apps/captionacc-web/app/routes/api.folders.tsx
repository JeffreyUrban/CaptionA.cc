import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import type { FoldersMetadata } from '~/types/videos'
import { getAllVideos, type VideoMetadata } from '~/utils/video-paths'

interface FolderItem {
  path: string
  name: string
}

/**
 * Extract unique folder paths from video display paths
 * For example, "a_bite_of_china/1/1a" yields:
 * - "a_bite_of_china"
 * - "a_bite_of_china/1"
 */
function extractFoldersFromVideos(videos: VideoMetadata[]): FolderItem[] {
  const folderSet = new Set<string>()

  // Extract all folder paths from video display paths
  for (const video of videos) {
    const parts = video.displayPath.split('/')
    // Generate all parent folder paths
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/')
      folderSet.add(folderPath)
    }
  }

  // Convert to FolderItem array
  const folders: FolderItem[] = Array.from(folderSet).map(path => ({
    path,
    name: path.split('/').pop() ?? '',
  }))

  return folders
}

/**
 * Read empty folders from metadata file
 * These are folders that don't contain any videos yet
 */
function getEmptyFolders(): string[] {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
  const foldersMetaPath = resolve(dataDir, '.folders.json')

  try {
    if (existsSync(foldersMetaPath)) {
      const content = readFileSync(foldersMetaPath, 'utf-8')
      const metadata: FoldersMetadata = JSON.parse(content)
      return metadata.emptyFolders ?? []
    }
  } catch {
    // If file doesn't exist or is invalid, return empty
  }

  return []
}

/**
 * API endpoint that returns list of available folders for upload destination
 * Uses virtual folder paths (display_path) from the database, not physical storage paths
 */
export async function loader() {
  // Get all videos and extract their folder paths
  const videos = await getAllVideos()
  const folders = extractFoldersFromVideos(videos)

  // Add empty folders from metadata
  const emptyFolders = getEmptyFolders()
  for (const folderPath of emptyFolders) {
    if (!folders.some(f => f.path === folderPath)) {
      folders.push({
        path: folderPath,
        name: folderPath.split('/').pop() ?? '',
      })
    }
  }

  // Sort folders alphabetically
  folders.sort((a, b) => a.path.localeCompare(b.path))

  return new Response(JSON.stringify({ folders }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
