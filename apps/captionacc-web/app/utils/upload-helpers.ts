/**
 * Utility functions for the Upload workflow.
 * Contains formatting, file processing, and path manipulation helpers.
 */

import type {
  VideoFilePreview,
  FileWithPath,
  FileSystemEntry,
  FileSystemFileEntry,
  FileSystemDirectoryEntry,
} from '~/types/upload'

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats a byte count into a human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Formats a duration in seconds into a human-readable string (e.g., "2h 30m")
 */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hrs > 0) return `${hrs}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

// ============================================================================
// Video Status Helpers
// ============================================================================

/**
 * Check if a video is in an active upload state (not finished)
 */
export function isVideoInProgress(video: VideoFilePreview): boolean {
  return (
    video.uploadStatus === 'uploading' ||
    video.uploadStatus === 'retrying' ||
    video.uploadStatus === 'pending' ||
    video.uploadStatus === 'stalled'
  )
}

/**
 * Check if a video is finished (complete or error)
 */
export function isVideoFinished(video: VideoFilePreview): boolean {
  return video.uploadStatus === 'complete' || video.uploadStatus === 'error'
}

/**
 * Helper to determine if an error is retryable (network issues, timeouts, 5xx errors)
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('5')
  ) // 5xx status codes
}

// ============================================================================
// Path Calculation Functions
// ============================================================================

/**
 * Calculate the target video path from a file's relative path.
 * Removes file extension and prepends selected folder if provided.
 */
export function calculateTargetPath(video: VideoFilePreview, selectedFolder: string): string {
  const pathParts = video.relativePath.split('/')
  const filename = pathParts[pathParts.length - 1]
  if (!filename) return ''

  let videoPath = pathParts
    .slice(0, -1)
    .concat(filename.replace(/\.\w+$/, ''))
    .join('/')

  if (selectedFolder) {
    videoPath = selectedFolder + '/' + videoPath
  }

  return videoPath
}

/**
 * Get original file path (before collapse) from a video file
 */
export function getOriginalPath(video: VideoFilePreview): string {
  return (video.file as FileWithPath).webkitRelativePath ?? video.file.name
}

// ============================================================================
// Folder Collapse Functions
// ============================================================================

/**
 * Collapse single-video folders to avoid unnecessary nesting.
 * Only collapses if the target folder doesn't already exist in local/data.
 * Stops collapsing when reaching an existing folder.
 *
 * Example: "level1/level2/video.mp4" where level2 only has one video
 * and doesn't exist -> becomes "show/video.mp4" (if show exists or is root)
 *
 * @param videos - Array of video files to process
 * @param preview - If true, don't modify videos, just check if collapses would happen
 * @returns Number of collapses that were (or would be) performed
 */
export async function collapseSingleVideoFolders(
  videos: VideoFilePreview[],
  preview: boolean = false
): Promise<number> {
  if (videos.length === 0) return 0

  // Fetch existing folders from the server
  let existingFolders = new Set<string>()
  try {
    const response = await fetch('/api/folders')
    const data = await response.json()
    existingFolders = new Set((data.folders ?? []).map((f: { path: string }) => f.path))
    console.log(`[collapseSingleVideoFolders] Found ${existingFolders.size} existing folders`)
  } catch (error) {
    console.error('[collapseSingleVideoFolders] Failed to fetch existing folders:', error)
    return 0 // Don't collapse if we can't check existing folders
  }

  let totalCollapses = 0
  let changed = true

  while (changed) {
    changed = false

    // Build a map of folder paths to their video counts
    const folderCounts = new Map<string, number>()

    for (const video of videos) {
      const pathParts = video.relativePath.split('/')
      // Count videos in each folder level
      for (let i = 1; i < pathParts.length; i++) {
        const folderPath = pathParts.slice(0, i).join('/')
        folderCounts.set(folderPath, (folderCounts.get(folderPath) ?? 0) + 1)
      }
    }

    // Check each video for single-video parent folders
    for (const video of videos) {
      const pathParts = video.relativePath.split('/')

      // Need at least 2 parts (folder/file) to collapse
      if (pathParts.length < 2) continue

      // Check if the immediate parent folder only has this one video
      const parentFolder = pathParts.slice(0, -1).join('/')

      // Collapse if the parent folder:
      // 1. Would only have this one video (from current upload batch)
      // 2. Doesn't already exist in local/data
      if (folderCounts.get(parentFolder) === 1 && !existingFolders.has(parentFolder)) {
        totalCollapses++

        if (!preview) {
          const filename = pathParts[pathParts.length - 1]
          if (!filename) continue
          const newPathParts = pathParts.slice(0, -2).concat(filename)
          const newRelativePath = newPathParts.length > 0 ? newPathParts.join('/') : filename

          console.log(
            `[collapseSingleVideoFolders] Collapsing: ${video.relativePath} -> ${newRelativePath}`
          )
          video.relativePath = newRelativePath
          changed = true // Only continue looping if we actually modified paths
        }
      }
    }
  }

  return totalCollapses
}

// ============================================================================
// File Tree Traversal
// ============================================================================

/**
 * Recursively traverse a file system entry (file or directory) and collect all files.
 * This handles the non-standard FileSystem API used in drag-and-drop operations.
 *
 * @param item - The file system entry to traverse
 * @param path - The current path prefix
 * @param files - Array to collect files into
 */
export async function traverseFileTree(
  item: FileSystemEntry,
  path: string,
  files: File[]
): Promise<void> {
  console.log(
    `[traverseFileTree] Processing: ${path}${item.name}, isFile=${item.isFile}, isDirectory=${item.isDirectory}`
  )

  if (item.isFile) {
    console.log(`[traverseFileTree] Getting file for: ${item.name}`)
    const fileEntry = item as FileSystemFileEntry
    const file = await new Promise<File>(resolve => {
      fileEntry.file((f: File) => {
        console.log(`[traverseFileTree] Got file: ${f.name}, size=${f.size}, type=${f.type}`)
        Object.defineProperty(f, 'webkitRelativePath', {
          value: path + f.name,
          writable: false,
        })
        resolve(f)
      })
    })
    files.push(file)
    console.log(`[traverseFileTree] Pushed file, files.length now = ${files.length}`)
  } else if (item.isDirectory) {
    const dirEntry = item as FileSystemDirectoryEntry
    const dirReader = dirEntry.createReader()
    const entries = await new Promise<FileSystemEntry[]>(resolve => {
      dirReader.readEntries((entries: FileSystemEntry[]) => resolve(entries))
    })
    for (const entry of entries) {
      await traverseFileTree(entry, path + item.name + '/', files)
    }
  }
}

// ============================================================================
// Upload Statistics
// ============================================================================

/**
 * Calculate upload statistics from the video files array
 */
export function calculateUploadStats(videoFiles: VideoFilePreview[]): {
  selectedCount: number
  completedCount: number
  errorCount: number
  uploadingCount: number
  retryingCount: number
  pendingCount: number
  stalledCount: number
  totalSize: number
  overallProgress: number
  hasActiveUploads: boolean
} {
  const selectedVideos = videoFiles.filter(v => v.selected)
  const selectedCount = selectedVideos.length
  const completedCount = selectedVideos.filter(v => v.uploadStatus === 'complete').length
  const errorCount = selectedVideos.filter(v => v.uploadStatus === 'error').length
  const uploadingCount = selectedVideos.filter(v => v.uploadStatus === 'uploading').length
  const retryingCount = selectedVideos.filter(v => v.uploadStatus === 'retrying').length
  const pendingCount = selectedVideos.filter(v => v.uploadStatus === 'pending').length
  const stalledCount = selectedVideos.filter(v => v.uploadStatus === 'stalled').length
  const totalSize = selectedVideos.reduce((sum, v) => sum + v.size, 0)
  const overallProgress = selectedCount > 0 ? (completedCount / selectedCount) * 100 : 0
  const hasActiveUploads =
    uploadingCount > 0 || retryingCount > 0 || pendingCount > 0 || stalledCount > 0

  return {
    selectedCount,
    completedCount,
    errorCount,
    uploadingCount,
    retryingCount,
    pendingCount,
    stalledCount,
    totalSize,
    overallProgress,
    hasActiveUploads,
  }
}

/**
 * Estimate upload time based on file size.
 * Assumes 10 Mbps = 1.25 MB/s transfer rate.
 */
export function estimateUploadTime(totalBytes: number): number {
  return totalBytes / (1.25 * 1024 * 1024)
}
