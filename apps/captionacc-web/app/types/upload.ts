/**
 * Type definitions for the Upload workflow.
 * These types are used across hooks and components for video file uploads.
 */

// ============================================================================
// File System API Types (non-standard but widely supported)
// ============================================================================

/**
 * Extend File to include webkitRelativePath (non-standard but widely supported)
 */
export interface FileWithPath extends Omit<File, 'webkitRelativePath'> {
  webkitRelativePath?: string
}

/**
 * Base interface for file system entries
 */
export interface FileSystemEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
}

/**
 * File entry in the FileSystem API
 */
export interface FileSystemFileEntry extends FileSystemEntry {
  isFile: true
  file(callback: (file: File) => void): void
}

/**
 * Directory entry in the FileSystem API
 */
export interface FileSystemDirectoryEntry extends FileSystemEntry {
  isDirectory: true
  createReader(): FileSystemDirectoryReader
}

/**
 * Directory reader for iterating directory contents
 */
export interface FileSystemDirectoryReader {
  readEntries(callback: (entries: FileSystemEntry[]) => void): void
}

// ============================================================================
// Data Models
// ============================================================================

/**
 * A folder item for the folder selector dropdown
 */
export interface FolderItem {
  path: string
  name: string
}

/**
 * Incomplete upload metadata from upload store
 */
export interface IncompleteUpload {
  uploadId: string
  videoId: string
  videoPath: string
  filename: string
  uploadLength: number
  currentSize: number
  progress: number
  createdAt: string
}

/**
 * Upload status for each video file
 */
export type UploadStatus =
  | 'pending'
  | 'queued'
  | 'uploading'
  | 'complete'
  | 'error'
  | 'paused'
  | 'stalled'
  | 'retrying'

/**
 * Preview information for a video file to be uploaded
 */
export interface VideoFilePreview {
  file: File
  relativePath: string
  size: number
  type: string
  selected: boolean
  uploadProgress: number
  uploadStatus: UploadStatus
  uploadId?: string
  uploadUrl?: string // Upload URL for resumability
  videoId?: string // UUID of created video (set when upload completes)
  error?: string
  isDuplicate?: boolean // Pre-upload duplicate check (by path)
  existingUploadedAt?: string
  retryCount?: number
  lastActivityAt?: number // Timestamp for stall detection

  // Post-upload duplicate resolution (by hash)
  pendingDuplicateResolution?: boolean
  duplicateOfVideoId?: string
  duplicateOfDisplayPath?: string
}

// ============================================================================
// Upload Configuration Constants
// ============================================================================

/** Number of concurrent uploads to process at once */
export const CONCURRENT_UPLOADS = 3

/** Exponential backoff retry delays in milliseconds */
export const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000, 60000]

/** Maximum number of retry attempts for failed uploads */
export const MAX_RETRIES = 2

/** Time without progress before marking upload as stalled (60 seconds) */
export const STALL_TIMEOUT = 60000

// ============================================================================
// Upload State Types
// ============================================================================

/**
 * Statistics about the current upload batch
 */
export interface UploadStats {
  selectedCount: number
  completedCount: number
  errorCount: number
  uploadingCount: number
  retryingCount: number
  pendingCount: number
  stalledCount: number
  totalSize: number
  overallProgress: number
}

/**
 * Flags for the upload workflow state
 */
export interface UploadWorkflowState {
  showConfirmation: boolean
  showSkipped: boolean
  uploading: boolean
  hasActiveUploads: boolean
}
