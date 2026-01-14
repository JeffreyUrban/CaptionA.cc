/**
 * Upload Folder Structure Processing
 *
 * Handles folder structure options for uploads:
 * - Preserve folder structure
 * - Flatten (all files in target folder)
 * - Collapse single-file folders
 */

export type FolderStructureMode = 'preserve' | 'flatten'

export interface UploadFile {
  file: File
  relativePath: string // Original path from drop/selection
}

export interface UploadOptions {
  mode: FolderStructureMode
  collapseSingles: boolean
  targetFolder: string | null
}

export interface ProcessedUpload {
  file: File
  originalPath: string
  finalPath: string // Path after applying options
  fileName: string
}

interface FolderNode {
  name: string
  files: UploadFile[]
  subfolders: Map<string, FolderNode>
}

/**
 * Build a folder tree from upload files
 */
function buildFolderTree(files: UploadFile[]): FolderNode {
  const root: FolderNode = {
    name: '',
    files: [],
    subfolders: new Map(),
  }

  for (const uploadFile of files) {
    const segments = uploadFile.relativePath.split('/')
    let current = root

    // Navigate/create folders for all segments except the last (filename)
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      if (!segment) continue

      if (!current.subfolders.has(segment)) {
        current.subfolders.set(segment, {
          name: segment,
          files: [],
          subfolders: new Map(),
        })
      }
      current = current.subfolders.get(segment)!
    }

    // Add file to the final folder
    current.files.push(uploadFile)
  }

  return root
}

/**
 * Check if a folder will have only one file after upload
 * Must consider existing files at the destination
 */
async function willHaveSingleFile(
  folderPath: string,
  newFileCount: number,
  targetFolder: string | null
): Promise<boolean> {
  // Check existing files at this folder path
  const fullPath = targetFolder ? `${targetFolder}/${folderPath}` : folderPath

  try {
    const response = await fetch(`/api/folders/file-count?path=${encodeURIComponent(fullPath)}`)
    if (!response.ok) return newFileCount === 1 // Assume folder doesn't exist

    const data = await response.json()
    const existingCount = data.fileCount ?? 0

    return existingCount + newFileCount === 1
  } catch {
    // If API fails, assume folder doesn't exist
    return newFileCount === 1
  }
}

/**
 * Collapse single-file folders in the tree
 * Only collapse if destination will have exactly one file (considering existing files)
 */
async function collapseSingleFileFolders(
  node: FolderNode,
  currentPath: string,
  targetFolder: string | null
): Promise<void> {
  // Process subfolders first (depth-first)
  for (const [name, subfolder] of node.subfolders) {
    const subfolderPath = currentPath ? `${currentPath}/${name}` : name
    await collapseSingleFileFolders(subfolder, subfolderPath, targetFolder)
  }

  // Check if this folder should be collapsed
  // A folder is collapsed if it will have exactly 1 file after upload
  if (node.files.length === 1 && node.subfolders.size === 0) {
    const file = node.files[0]
    if (!file) return // TypeScript guard

    const folderPath = currentPath
    const willBeSingle = await willHaveSingleFile(folderPath, 1, targetFolder)

    if (willBeSingle && currentPath) {
      // Collapse: move file up to parent, keeping video filename
      const fileName = file.relativePath.split('/').pop()!
      const parentPath = currentPath.split('/').slice(0, -1).join('/')

      // Update the file's relative path to collapsed location
      file.relativePath = parentPath ? `${parentPath}/${fileName}` : fileName
    }
  }
}

/**
 * Process files according to folder structure options
 */
export async function processUploadFiles(
  files: UploadFile[],
  options: UploadOptions
): Promise<ProcessedUpload[]> {
  const results: ProcessedUpload[] = []

  if (options.mode === 'flatten') {
    // Flatten: all files go directly in target folder
    for (const uploadFile of files) {
      const fileName = uploadFile.relativePath.split('/').pop()!
      const finalPath = options.targetFolder ? `${options.targetFolder}/${fileName}` : fileName

      results.push({
        file: uploadFile.file,
        originalPath: uploadFile.relativePath,
        finalPath,
        fileName,
      })
    }
  } else {
    // Preserve structure
    if (options.collapseSingles) {
      // Build tree and collapse singles
      const tree = buildFolderTree(files)
      await collapseSingleFileFolders(tree, '', options.targetFolder)
    }

    // Generate final paths
    for (const uploadFile of files) {
      const fileName = uploadFile.relativePath.split('/').pop()!
      const finalPath = options.targetFolder
        ? `${options.targetFolder}/${uploadFile.relativePath}`
        : uploadFile.relativePath

      results.push({
        file: uploadFile.file,
        originalPath: uploadFile.relativePath,
        finalPath,
        fileName,
      })
    }
  }

  return results
}

/**
 * Get a preview of the folder structure that will be created
 */
export function getFolderStructurePreview(processed: ProcessedUpload[]): {
  folders: string[]
  files: Array<{ path: string; size: number }>
  totalSize: number
} {
  const folderSet = new Set<string>()
  const files: Array<{ path: string; size: number }> = []
  let totalSize = 0

  for (const upload of processed) {
    // Extract folders from path
    const pathParts = upload.finalPath.split('/')
    for (let i = 0; i < pathParts.length - 1; i++) {
      const folderPath = pathParts.slice(0, i + 1).join('/')
      folderSet.add(folderPath)
    }

    // Add file
    files.push({
      path: upload.finalPath,
      size: upload.file.size,
    })
    totalSize += upload.file.size
  }

  return {
    folders: Array.from(folderSet).sort(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    totalSize,
  }
}
