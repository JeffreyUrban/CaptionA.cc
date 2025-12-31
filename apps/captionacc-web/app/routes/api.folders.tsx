import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { resolve } from 'path'

interface FolderItem {
  path: string
  name: string
}

/**
 * Recursively find all folders in the data directory
 * Returns folders that either:
 * - Contain video subdirectories
 * - Are empty leaf folders
 */
async function findFolders(
  dir: string,
  baseDir: string,
  parentPath: string = ''
): Promise<FolderItem[]> {
  const folders: FolderItem[] = []

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    // Check if this directory has an annotations.db file
    const hasAnnotationsDb = entries.some(
      entry => entry.isFile() && entry.name === 'annotations.db'
    )

    if (hasAnnotationsDb) {
      // This is a video directory - don't include it or descend into it
      return folders
    }

    // Skip known data directories
    const skipDirs = new Set(['crop_frames', 'full_frames'])
    const subdirs = entries.filter(entry => entry.isDirectory() && !skipDirs.has(entry.name))

    // If this directory has subdirectories, include it as a folder and recurse
    if (subdirs.length > 0) {
      // Add this folder if it's not the root
      if (parentPath) {
        const folderName = parentPath.split('/').pop()
        folders.push({
          path: parentPath,
          name: folderName ?? '',
        })
      }

      // Recurse into subdirectories
      for (const entry of subdirs) {
        const fullPath = resolve(dir, entry.name)
        const newParentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
        const subFolders = await findFolders(fullPath, baseDir, newParentPath)
        folders.push(...subFolders)
      }
    } else {
      // This is an empty leaf folder - include it
      if (parentPath) {
        const folderName = parentPath.split('/').pop()
        folders.push({
          path: parentPath,
          name: folderName ?? '',
        })
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error)
  }

  return folders
}

/**
 * API endpoint that returns list of available folders for upload destination
 */
export async function loader() {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  if (!existsSync(dataDir)) {
    return new Response(JSON.stringify({ folders: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Find all folders
  const folders = await findFolders(dataDir, dataDir)

  // Sort folders alphabetically
  folders.sort((a, b) => a.path.localeCompare(b.path))

  // Remove duplicates (in case a folder was found multiple times)
  const uniqueFolders = folders.filter(
    (folder, index, self) => index === self.findIndex(f => f.path === folder.path)
  )

  return new Response(JSON.stringify({ folders: uniqueFolders }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
