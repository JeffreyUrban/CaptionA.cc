/**
 * Upload Manager Service - Singleton for managing S3 uploads
 *
 * This service:
 * - Manages S3 uploads using presigned URLs from Supabase Edge Function
 * - Integrates with upload-store for state persistence
 * - Supports concurrent uploads with queue management
 * - Handles retry logic with exponential backoff
 *
 * The service persists across navigation because it's a singleton,
 * allowing uploads to continue when user navigates between pages.
 */

import {
  uploadFileToS3,
  createUploadAbortController,
  cancelUpload as cancelS3Upload,
  type S3UploadOptions,
} from '~/services/s3-upload'
import { useUploadStore } from '~/stores/upload-store'
import { CONCURRENT_UPLOADS, STALL_TIMEOUT } from '~/types/upload'

// ============================================================================
// Upload Manager Class
// ============================================================================

class UploadManager {
  // Active S3 upload abort controllers (in-memory, not persisted)
  private activeUploads = new Map<string, AbortController>()

  // Files being uploaded (transient state, not in store)
  private uploadFiles = new Map<string, File>()

  // Stall detection
  private lastProgressTime = new Map<string, number>()
  private stallCheckInterval: NodeJS.Timeout | null = null

  // Track if we've done initial cleanup (avoid circular dependency in constructor)
  private hasCleanedOrphans = false

  /**
   * Clean up uploads that can't be resumed (no file available)
   * This happens when page refreshes or navigates - sessionStorage persists
   * but File objects don't, so we can't resume these uploads
   *
   * Called lazily on first operation to avoid circular dependency issues
   */
  private cleanupOrphanedUploads(): void {
    if (this.hasCleanedOrphans) return
    this.hasCleanedOrphans = true

    const store = useUploadStore.getState()
    const activeUploads = Object.values(store.activeUploads)

    // Find uploads without files (can't be resumed)
    const orphanedUploads = activeUploads.filter(upload => !this.uploadFiles.has(upload.id))

    if (orphanedUploads.length > 0) {
      console.log(
        `[UploadManager] Cleaning up ${orphanedUploads.length} orphaned uploads from sessionStorage`
      )
      orphanedUploads.forEach(upload => {
        console.log(`[UploadManager] Removing orphaned upload: ${upload.fileName}`)
        store.removeUpload(upload.id)
      })
    }
  }

  /**
   * Initialize upload for a file
   */
  async startUpload(
    file: File,
    metadata: {
      fileName: string
      fileType: string
      targetFolder: string | null
      relativePath: string
    }
  ): Promise<string> {
    // Clean up orphaned uploads on first use (lazy initialization)
    this.cleanupOrphanedUploads()

    const store = useUploadStore.getState()

    // Add upload to store (returns generated ID)
    const uploadId = store.addUpload({
      fileName: metadata.fileName,
      fileSize: file.size,
      fileType: metadata.fileType,
      relativePath: metadata.relativePath,
      targetFolder: metadata.targetFolder,
    })

    // Store file reference
    this.uploadFiles.set(uploadId, file)

    // Start upload immediately or queue it
    this.processUploadQueue()

    return uploadId
  }

  /**
   * Create and start an S3 upload using presigned URL
   */
  private async createS3Upload(uploadId: string): Promise<void> {
    const store = useUploadStore.getState()
    const uploadMetadata = store.activeUploads[uploadId]
    const file = this.uploadFiles.get(uploadId)

    if (!uploadMetadata || !file) {
      console.error(`[UploadManager] Missing metadata or file for ${uploadId}`)
      return
    }

    // Construct video path from relative path
    const pathParts = uploadMetadata.relativePath.split('/')
    const filename = pathParts[pathParts.length - 1]
    if (!filename) {
      console.error(`[UploadManager] Invalid filename for ${uploadMetadata.relativePath}`)
      return
    }

    let videoPath = pathParts
      .slice(0, -1)
      .concat(filename.replace(/\.\w+$/, ''))
      .join('/')

    // Prepend target folder if specified
    if (uploadMetadata.targetFolder) {
      videoPath = uploadMetadata.targetFolder + '/' + videoPath
    }

    console.log(`[UploadManager] Starting S3 upload for ${uploadMetadata.relativePath}`)

    // Create abort controller for cancellation
    const abortController = createUploadAbortController()
    this.activeUploads.set(uploadId, abortController)

    // Update status to uploading
    store.updateStatus(uploadId, 'uploading')
    this.lastProgressTime.set(uploadId, Date.now())

    // Start stall detection if not already running
    this.startStallDetection()

    try {
      // Upload to S3 using presigned URL
      const result = await uploadFileToS3({
        file,
        filename,
        contentType: uploadMetadata.fileType,
        folderPath: uploadMetadata.targetFolder,
        signal: abortController.signal,
        onProgress: (bytesUploaded, progress) => {
          // Update store
          store.updateProgress(uploadId, bytesUploaded, progress)

          // Track activity for stall detection
          this.lastProgressTime.set(uploadId, Date.now())
        },
        onError: error => {
          // Update status with error message (but keep trying if retry logic continues)
          console.warn(
            `[UploadManager] Upload error for ${uploadMetadata.relativePath}:`,
            error.message
          )
        },
      })

      // Upload successful
      console.log(
        `[UploadManager] Upload complete for ${uploadMetadata.relativePath}, video ID: ${result.videoId}`
      )

      // Move to completed uploads
      store.completeUpload(uploadId, result.videoId)

      // Mark video as touched for video list refresh
      if (typeof window !== 'undefined') {
        try {
          const touchedList = localStorage.getItem('touched-videos')
          const touched = touchedList ? new Set(JSON.parse(touchedList)) : new Set()
          touched.add(videoPath) // videoPath is the display_path
          localStorage.setItem('touched-videos', JSON.stringify(Array.from(touched)))
          console.log(`[UploadManager] Marked ${videoPath} as touched for refresh`)
        } catch (e) {
          console.error('[UploadManager] Failed to mark video as touched:', e)
        }
      }

      // Cleanup
      this.activeUploads.delete(uploadId)
      this.uploadFiles.delete(uploadId)
      this.lastProgressTime.delete(uploadId)

      // Process next in queue
      setTimeout(() => this.processUploadQueue(), 100)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Handle cancellation
      if (err.message.includes('cancelled') || err.message.includes('abort')) {
        console.log(`[UploadManager] Upload cancelled for ${uploadMetadata.relativePath}`)
        // Don't update store - cancelUpload() will handle removal
        return
      }

      // Upload failed after all retries
      console.error(`[UploadManager] Upload failed for ${uploadMetadata.relativePath}:`, err)

      store.updateStatus(uploadId, 'error', err.message)
      this.activeUploads.delete(uploadId)
      this.uploadFiles.delete(uploadId)
      this.lastProgressTime.delete(uploadId)

      // Process next in queue
      setTimeout(() => this.processUploadQueue(), 100)
    }
  }

  /**
   * Process the upload queue - start uploads for available slots
   */
  private processUploadQueue(): void {
    const store = useUploadStore.getState()

    // Count currently uploading
    const activeCount = this.activeUploads.size

    // Calculate available slots
    const availableSlots = CONCURRENT_UPLOADS - activeCount
    if (availableSlots <= 0) return

    // Find uploads ready to start (pending status)
    const pendingUploads = Object.values(store.activeUploads)
      .filter(upload => upload.status === 'pending')
      .slice(0, availableSlots)

    // Start uploads
    pendingUploads.forEach(upload => {
      void this.createS3Upload(upload.id)
    })
  }

  /**
   * Resume an incomplete upload from persisted metadata
   * Note: S3 uploads with presigned URLs don't support true resume like TUS.
   * This will restart the upload from the beginning with a new presigned URL.
   */
  async resumeUpload(uploadId: string, file: File): Promise<void> {
    const store = useUploadStore.getState()
    const uploadMetadata = store.activeUploads[uploadId]

    if (!uploadMetadata) {
      console.error(`[UploadManager] No metadata found for ${uploadId}`)
      return
    }

    console.log(
      `[UploadManager] Resuming upload ${uploadMetadata.fileName} (will restart from beginning)`
    )

    // Store file reference
    this.uploadFiles.set(uploadId, file)

    // Reset status to pending
    store.updateStatus(uploadId, 'pending')

    // Process queue (will pick up this upload)
    this.processUploadQueue()
  }

  /**
   * Cancel an upload
   */
  async cancelUpload(uploadId: string): Promise<void> {
    const abortController = this.activeUploads.get(uploadId)

    if (abortController) {
      cancelS3Upload(abortController)
      this.activeUploads.delete(uploadId)
    }

    const store = useUploadStore.getState()

    // Remove from store entirely (don't just mark as cancelled)
    store.removeUpload(uploadId)

    // Cleanup
    this.uploadFiles.delete(uploadId)
    this.lastProgressTime.delete(uploadId)

    // Process queue to fill the slot
    this.processUploadQueue()
  }

  /**
   * Retry a failed upload
   */
  async retryUpload(uploadId: string): Promise<void> {
    const store = useUploadStore.getState()
    const upload = store.activeUploads[uploadId]
    const file = this.uploadFiles.get(uploadId)

    if (!upload || !file) {
      console.error(`[UploadManager] Cannot retry ${uploadId}: missing upload or file`)
      return
    }

    console.log(`[UploadManager] Retrying upload ${upload.fileName}`)

    // Cancel the failed upload first
    await this.cancelUpload(uploadId)

    // Start a new upload with the same file
    await this.startUpload(file, {
      fileName: upload.fileName,
      fileType: upload.fileType,
      targetFolder: upload.targetFolder,
      relativePath: upload.relativePath,
    })
  }

  /**
   * Cancel all active uploads
   */
  async cancelAll(): Promise<void> {
    const uploadIds = Array.from(this.activeUploads.keys())

    // Abort all active uploads
    uploadIds.forEach(id => {
      const abortController = this.activeUploads.get(id)
      if (abortController) {
        cancelS3Upload(abortController)
      }
    })

    const store = useUploadStore.getState()

    // Remove all from store
    uploadIds.forEach(id => {
      store.removeUpload(id)
    })

    // Cleanup
    this.activeUploads.clear()
    this.uploadFiles.clear()
    this.lastProgressTime.clear()

    this.stopStallDetection()
  }

  /**
   * Stall detection - check for uploads with no progress
   */
  private startStallDetection(): void {
    if (this.stallCheckInterval) return

    this.stallCheckInterval = setInterval(() => {
      const now = Date.now()

      this.lastProgressTime.forEach((lastTime, uploadId) => {
        const timeSinceActivity = now - lastTime

        if (timeSinceActivity > STALL_TIMEOUT) {
          console.warn(
            `[UploadManager] Upload ${uploadId} stalled (no activity for ${timeSinceActivity}ms)`
          )

          // Abort stalled upload and retry
          const abortController = this.activeUploads.get(uploadId)
          if (abortController) {
            cancelS3Upload(abortController)
            this.activeUploads.delete(uploadId)

            // Mark as pending for retry
            const store = useUploadStore.getState()
            store.updateStatus(uploadId, 'pending', 'Upload stalled - retrying')

            // Retry - S3 upload has built-in retry logic, so just re-queue
            setTimeout(() => this.processUploadQueue(), 1000)
          }
        }
      })

      // Stop detection if no active uploads
      if (this.activeUploads.size === 0) {
        this.stopStallDetection()
      }
    }, 10000) // Check every 10 seconds
  }

  /**
   * Stop stall detection
   */
  private stopStallDetection(): void {
    if (this.stallCheckInterval) {
      clearInterval(this.stallCheckInterval)
      this.stallCheckInterval = null
    }
  }

  /**
   * Get active upload count
   */
  getActiveUploadCount(): number {
    return this.activeUploads.size
  }

  /**
   * Check if an upload is active
   */
  isUploadActive(uploadId: string): boolean {
    return this.activeUploads.has(uploadId)
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance - survives component unmounts and navigation
 */
export const uploadManager = new UploadManager()
