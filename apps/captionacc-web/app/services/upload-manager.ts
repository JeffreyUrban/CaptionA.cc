/**
 * Upload Manager Service - Singleton for managing TUS uploads
 *
 * This service:
 * - Manages TUS upload instances independent of React component lifecycle
 * - Integrates with upload-store for state persistence
 * - Supports concurrent uploads with queue management
 * - Handles retry logic with exponential backoff
 *
 * The service persists across navigation because it's a singleton,
 * allowing uploads to continue when user navigates between pages.
 */

import * as tus from 'tus-js-client'

import { useUploadStore } from '~/stores/upload-store'
import {
  CONCURRENT_UPLOADS,
  CHUNK_SIZE,
  RETRY_DELAYS,
  MAX_RETRIES,
  STALL_TIMEOUT,
} from '~/types/upload'
import { isRetryableError } from '~/utils/upload-helpers'

// ============================================================================
// Upload Manager Class
// ============================================================================

class UploadManager {
  // Active TUS upload instances (in-memory, not persisted)
  private activeUploads = new Map<string, tus.Upload>()

  // Files being uploaded (transient state, not in store)
  private uploadFiles = new Map<string, File>()

  // Retry tracking (upload-manager responsibility, not store)
  private retryCount = new Map<string, number>()

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
   * Create and start a TUS upload instance
   */
  private async createTusUpload(uploadId: string, retryCount: number = 0): Promise<void> {
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

    console.log(
      `[UploadManager] Starting ${uploadMetadata.relativePath} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`
    )

    // Get auth token from Supabase session
    const { supabase } = await import('~/services/supabase-client')
    const {
      data: { session },
    } = await supabase.auth.getSession()

    const upload = new tus.Upload(file, {
      endpoint: '/api/upload',
      retryDelays: RETRY_DELAYS,
      chunkSize: CHUNK_SIZE,
      uploadUrl: uploadMetadata.uploadUrl ?? undefined, // Resume from previous attempt

      metadata: {
        filename,
        filetype: uploadMetadata.fileType,
        videoPath,
      },

      headers: session?.access_token
        ? {
            Authorization: `Bearer ${session.access_token}`,
          }
        : {},

      onError: (error: Error | tus.DetailedError) => {
        // Log full error details for debugging
        const detailedError = error as tus.DetailedError
        console.error(`[UploadManager] Failed ${uploadMetadata.relativePath}:`, {
          message: error.message,
          error: error,
          originalRequest: detailedError.originalRequest,
          originalResponse: detailedError.originalResponse,
        })

        // Special handling for 404 errors (upload not found on server)
        // This happens when metadata was cleaned up after completion
        // Check multiple properties as TUS errors can be formatted differently
        const errorStr = String(error).toLowerCase()
        const messageStr = (error.message || '').toLowerCase()
        const is404 =
          messageStr.includes('404') ||
          messageStr.includes('not found') ||
          errorStr.includes('404') ||
          errorStr.includes('not found') ||
          detailedError.originalResponse?.getStatus?.() === 404

        if (is404) {
          console.log(
            `[UploadManager] Upload ${uploadId} not found on server - cleaning up from store`
          )
          store.removeUpload(uploadId)
          this.activeUploads.delete(uploadId)
          this.uploadFiles.delete(uploadId)
          this.retryCount.delete(uploadId)
          this.lastProgressTime.delete(uploadId)

          // Process next in queue
          setTimeout(() => this.processUploadQueue(), 100)
          return
        }

        // Check if we should retry
        const currentRetryCount = retryCount
        if (currentRetryCount < MAX_RETRIES && isRetryableError(error)) {
          const delay = RETRY_DELAYS[Math.min(currentRetryCount, RETRY_DELAYS.length - 1)]
          console.log(`[UploadManager] Will retry ${uploadMetadata.relativePath} in ${delay}ms`)

          // Update status to show retry
          store.updateStatus(uploadId, 'pending', `Retrying (attempt ${currentRetryCount + 1})`)
          this.retryCount.set(uploadId, currentRetryCount + 1)

          // Schedule retry
          setTimeout(() => {
            this.createTusUpload(uploadId, currentRetryCount + 1)
          }, delay)
        } else {
          // Max retries exceeded or non-retryable error
          store.updateStatus(uploadId, 'error', error.message)
          this.activeUploads.delete(uploadId)
          this.uploadFiles.delete(uploadId)
          this.retryCount.delete(uploadId)
          this.lastProgressTime.delete(uploadId)

          // Process next in queue
          setTimeout(() => this.processUploadQueue(), 100)
        }
      },

      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = Math.round((bytesUploaded / bytesTotal) * 100)

        // Update store
        store.updateProgress(uploadId, bytesUploaded, progress)

        // Track activity for stall detection
        this.lastProgressTime.set(uploadId, Date.now())
      },

      onSuccess: () => {
        console.log(`[UploadManager] Upload complete ${uploadMetadata.relativePath}`)

        // NOTE: Don't mark as completed here - wait for onAfterResponse to get videoId
        // If no videoId is provided (shouldn't happen), we'll handle it there

        // Track activity
        this.lastProgressTime.set(uploadId, Date.now())
      },

      onAfterResponse: (_req, res) => {
        // Store TUS upload URL for resumability
        const uploadUrl = res.getHeader('Location')
        if (uploadUrl) {
          store.setUploadUrl(uploadId, uploadUrl)
        }

        // Get video ID and duplicate detection from headers
        const videoId = res.getHeader('X-Video-Id')
        const isDuplicateHeader = res.getHeader('X-Duplicate-Detected')

        // Check if upload is complete (onSuccess was called)
        const uploadComplete = res.getStatus() === 204 || res.getStatus() === 200

        if (uploadComplete && videoId) {
          // Check for duplicate detection
          if (isDuplicateHeader === 'true') {
            const duplicateOfVideoId = res.getHeader('X-Duplicate-Of-Video-Id')
            const duplicateOfDisplayPath = res.getHeader('X-Duplicate-Of-Display-Path')

            if (duplicateOfVideoId && duplicateOfDisplayPath) {
              console.log(
                `[UploadManager] Duplicate detected for ${uploadId}: ${duplicateOfDisplayPath}`
              )

              // Move to pending duplicates (removes from active uploads)
              store.markAsDuplicate(uploadId, videoId, duplicateOfVideoId, duplicateOfDisplayPath)

              // Cleanup
              this.activeUploads.delete(uploadId)
              this.uploadFiles.delete(uploadId)
              this.retryCount.delete(uploadId)
              this.lastProgressTime.delete(uploadId)

              // Process next in queue
              setTimeout(() => this.processUploadQueue(), 100)
            }
          } else {
            // Normal completion - no duplicate
            console.log(`[UploadManager] Video created with ID: ${videoId}`)

            // Move to completed uploads
            store.completeUpload(uploadId, videoId)

            // Mark video as touched for video list refresh
            // The video list uses display_path (videoPath) as the identifier
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
            this.retryCount.delete(uploadId)
            this.lastProgressTime.delete(uploadId)

            // Process next in queue
            setTimeout(() => this.processUploadQueue(), 100)
          }
        }
      },
    })

    // Start upload and track instance
    upload.start()
    this.activeUploads.set(uploadId, upload)

    // Update status to uploading
    store.updateStatus(uploadId, 'uploading')
    this.lastProgressTime.set(uploadId, Date.now())

    // Start stall detection if not already running
    this.startStallDetection()
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
      const retryCount = this.retryCount.get(upload.id) ?? 0
      this.createTusUpload(upload.id, retryCount)
    })
  }

  /**
   * Resume an incomplete upload from persisted metadata
   */
  async resumeUpload(uploadId: string, file: File): Promise<void> {
    const store = useUploadStore.getState()
    const uploadMetadata = store.activeUploads[uploadId]

    if (!uploadMetadata) {
      console.error(`[UploadManager] No metadata found for ${uploadId}`)
      return
    }

    if (!uploadMetadata.uploadUrl) {
      console.error(`[UploadManager] No upload URL to resume for ${uploadId}`)
      return
    }

    console.log(`[UploadManager] Resuming upload ${uploadMetadata.fileName}`)

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
    const upload = this.activeUploads.get(uploadId)

    if (upload) {
      await upload.abort()
      this.activeUploads.delete(uploadId)
    }

    const store = useUploadStore.getState()

    // Remove from store entirely (don't just mark as cancelled)
    store.removeUpload(uploadId)

    // Cleanup
    this.uploadFiles.delete(uploadId)
    this.retryCount.delete(uploadId)
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
    await Promise.all(
      uploadIds.map(id =>
        this.activeUploads
          .get(id)
          ?.abort()
          .catch(err => {
            console.error(`[UploadManager] Error aborting ${id}:`, err)
          })
      )
    )

    const store = useUploadStore.getState()

    // Remove all from store
    uploadIds.forEach(id => {
      store.removeUpload(id)
    })

    // Cleanup
    this.activeUploads.clear()
    this.uploadFiles.clear()
    this.retryCount.clear()
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
          const upload = this.activeUploads.get(uploadId)
          if (upload) {
            void upload.abort().then(() => {
              this.activeUploads.delete(uploadId)

              // Mark as pending for retry
              const store = useUploadStore.getState()
              store.updateStatus(uploadId, 'pending', 'Upload stalled - retrying')

              // Retry
              const retryCount = this.retryCount.get(uploadId) ?? 0
              if (retryCount < MAX_RETRIES) {
                this.retryCount.set(uploadId, retryCount + 1)
                setTimeout(() => this.processUploadQueue(), 1000)
              }
            })
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
