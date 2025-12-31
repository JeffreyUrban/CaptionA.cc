/**
 * Upload Manager Service - Singleton for managing TUS uploads
 *
 * This service:
 * - Manages TUS upload instances independent of React component lifecycle
 * - Integrates with Zustand store for state persistence
 * - Supports concurrent uploads with queue management
 * - Handles resume from persisted metadata (survives page refreshes)
 * - Provides retry logic with exponential backoff
 *
 * The service persists across navigation because it's a singleton,
 * allowing uploads to continue when user navigates between pages.
 */

import * as tus from 'tus-js-client'

import { useAppStore } from '~/stores/app-store'
import type { UploadMetadata } from '~/types/store'
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

  // Retry tracking
  private retryCount = new Map<string, number>()

  // Stall detection
  private lastProgressTime = new Map<string, number>()
  private stallCheckInterval: NodeJS.Timeout | null = null

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
    // Generate unique ID for this upload
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Create upload metadata in store
    const uploadMetadata: UploadMetadata = {
      id: uploadId,
      fileName: metadata.fileName,
      fileSize: file.size,
      fileType: metadata.fileType,
      targetFolder: metadata.targetFolder,
      relativePath: metadata.relativePath,
      uploadUrl: null,
      bytesUploaded: 0,
      progress: 0,
      status: 'pending',
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    }

    // Add to store
    useAppStore.getState().addUpload(uploadMetadata)

    // Store file reference
    this.uploadFiles.set(uploadId, file)

    // Start upload immediately or queue it
    this.processUploadQueue()

    return uploadId
  }

  /**
   * Create and start a TUS upload instance
   */
  private createTusUpload(uploadId: string, retryCount: number = 0): void {
    const store = useAppStore.getState()
    const uploadMetadata = store.uploads[uploadId]
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

      onError: error => {
        console.error(`[UploadManager] Failed ${uploadMetadata.relativePath}:`, error)

        // Check if we should retry
        const currentRetryCount = retryCount
        if (currentRetryCount < MAX_RETRIES && isRetryableError(error)) {
          const delay = RETRY_DELAYS[Math.min(currentRetryCount, RETRY_DELAYS.length - 1)]
          console.log(`[UploadManager] Will retry ${uploadMetadata.relativePath} in ${delay}ms`)

          // Update status to show retry
          store.updateUploadStatus(
            uploadId,
            'pending',
            `Retrying (attempt ${currentRetryCount + 1})`
          )
          this.retryCount.set(uploadId, currentRetryCount + 1)

          // Schedule retry
          setTimeout(() => {
            this.createTusUpload(uploadId, currentRetryCount + 1)
          }, delay)
        } else {
          // Max retries exceeded or non-retryable error
          store.updateUploadStatus(uploadId, 'failed', error.message)
          this.activeUploads.delete(uploadId)
          this.uploadFiles.delete(uploadId)
          this.retryCount.delete(uploadId)
          this.lastProgressTime.delete(uploadId)

          // Process next in queue
          setTimeout(() => this.processUploadQueue(), 100)
        }
      },

      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = (bytesUploaded / bytesTotal) * 100

        // Update store
        store.updateUploadProgress(uploadId, bytesUploaded, progress)

        // Track activity for stall detection
        this.lastProgressTime.set(uploadId, Date.now())
      },

      onSuccess: () => {
        console.log(`[UploadManager] Complete ${uploadMetadata.relativePath}`)

        // Update store
        store.updateUploadStatus(uploadId, 'completed')

        // Cleanup
        this.activeUploads.delete(uploadId)
        this.uploadFiles.delete(uploadId)
        this.retryCount.delete(uploadId)
        this.lastProgressTime.delete(uploadId)

        // Process next in queue
        setTimeout(() => this.processUploadQueue(), 100)
      },

      onAfterResponse: (_req, res) => {
        // Store TUS upload URL for resumability
        const uploadUrl = res.getHeader('Location')
        if (uploadUrl) {
          store.setUploadUrl(uploadId, uploadUrl)
        }
      },
    })

    // Start upload and track instance
    upload.start()
    this.activeUploads.set(uploadId, upload)

    // Update status to uploading
    store.updateUploadStatus(uploadId, 'uploading')
    this.lastProgressTime.set(uploadId, Date.now())

    // Start stall detection if not already running
    this.startStallDetection()
  }

  /**
   * Process the upload queue - start uploads for available slots
   */
  private processUploadQueue(): void {
    const store = useAppStore.getState()

    // Count currently uploading
    const activeCount = this.activeUploads.size

    // Calculate available slots
    const availableSlots = CONCURRENT_UPLOADS - activeCount
    if (availableSlots <= 0) return

    // Find uploads ready to start (pending status)
    const pendingUploads = Object.values(store.uploads)
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
    const store = useAppStore.getState()
    const uploadMetadata = store.uploads[uploadId]

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
    store.updateUploadStatus(uploadId, 'pending')

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

    const store = useAppStore.getState()
    store.updateUploadStatus(uploadId, 'cancelled', 'Cancelled by user')

    // Cleanup
    this.uploadFiles.delete(uploadId)
    this.retryCount.delete(uploadId)
    this.lastProgressTime.delete(uploadId)

    // Process queue to fill the slot
    this.processUploadQueue()
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

    // Update all statuses
    const store = useAppStore.getState()
    uploadIds.forEach(id => {
      store.updateUploadStatus(id, 'cancelled', 'Cancelled by user')
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
              const store = useAppStore.getState()
              store.updateUploadStatus(uploadId, 'pending', 'Upload stalled - retrying')

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
