/**
 * Upload Manager Service - Singleton for managing video uploads
 *
 * This service:
 * - Manages upload instances independent of React component lifecycle
 * - Integrates with upload-store for state persistence
 * - Supports concurrent uploads with queue management
 * - Handles retry logic with exponential backoff
 * - Uses Supabase Edge Functions to get presigned URLs for direct Wasabi S3 uploads
 *
 * The service persists across navigation because it's a singleton,
 * allowing uploads to continue when user navigates between pages.
 *
 * Upload Architecture (per API docs):
 * 1. POST {supabase_url}/functions/v1/captionacc-presigned-upload
 *    Body: { filename, contentType, sizeBytes }
 * 2. Response: { uploadUrl, videoId, storageKey, expiresAt }
 * 3. PUT to uploadUrl with file data
 */

import { useUploadStore } from '~/stores/upload-store'
import { CONCURRENT_UPLOADS, RETRY_DELAYS, MAX_RETRIES, STALL_TIMEOUT } from '~/types/upload'
import { isRetryableError } from '~/utils/upload-helpers'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Read video dimensions from a video file
 * Returns a promise that resolves with {width, height} or defaults to {width: 0, height: 0}
 */
async function getVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src)
      const width = video.videoWidth
      const height = video.videoHeight

      if (width > 0 && height > 0) {
        resolve({ width, height })
      } else {
        console.warn('[UploadManager] Could not read video dimensions, defaulting to 0x0')
        resolve({ width: 0, height: 0 })
      }
    }

    video.onerror = () => {
      window.URL.revokeObjectURL(video.src)
      console.warn('[UploadManager] Error reading video metadata, defaulting to 0x0')
      resolve({ width: 0, height: 0 })
    }

    video.src = window.URL.createObjectURL(file)
  })
}

/**
 * Upload file to presigned URL with progress tracking
 */
function uploadWithProgress(
  url: string,
  file: File,
  contentType: string,
  abortSignal: AbortSignal,
  onProgress: (loaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    // Handle abort signal
    const abortHandler = () => {
      xhr.abort()
      reject(new Error('Upload aborted'))
    }
    abortSignal.addEventListener('abort', abortHandler)

    // Track upload progress
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total)
      }
    })

    // Handle completion
    xhr.addEventListener('load', () => {
      abortSignal.removeEventListener('abort', abortHandler)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
      }
    })

    // Handle errors
    xhr.addEventListener('error', () => {
      abortSignal.removeEventListener('abort', abortHandler)
      reject(new Error('Upload failed: Network error'))
    })

    xhr.addEventListener('abort', () => {
      abortSignal.removeEventListener('abort', abortHandler)
      reject(new Error('Upload aborted'))
    })

    // Start upload
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.send(file)
  })
}

// ============================================================================
// Upload Manager Class
// ============================================================================

class UploadManager {
  // Active upload instances (AbortController for cancellation)
  private activeUploads = new Map<string, AbortController>()

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
   * Create and start an upload using presigned URL
   */
  private async createPresignedUpload(uploadId: string, retryCount: number = 0): Promise<void> {
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

    try {
      // Get Supabase client and session
      const { supabase } = await import('~/services/supabase-client')
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) {
        throw new Error(`Session error: ${sessionError.message}`)
      }

      if (!session?.access_token) {
        throw new Error('No authenticated session - please sign in')
      }

      // Read video dimensions from file metadata
      const dimensions = await getVideoDimensions(file)
      console.log(`[UploadManager] Video dimensions: ${dimensions.width}x${dimensions.height}`)

      // Step 1: Get presigned URL from Edge Function
      // POST /functions/v1/captionacc-presigned-upload
      const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']!

      const presignedResponse = await fetch(
        `${supabaseUrl}/functions/v1/captionacc-presigned-upload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            filename,
            contentType: uploadMetadata.fileType,
            sizeBytes: file.size,
            videoPath, // Include video path for backend processing
            width: dimensions.width,
            height: dimensions.height,
          }),
        }
      )

      if (!presignedResponse.ok) {
        const errorText = await presignedResponse.text()
        console.error('[UploadManager] Edge Function error:', errorText)
        throw new Error(`Failed to get presigned URL: ${presignedResponse.status} ${errorText}`)
      }

      const presignedData = (await presignedResponse.json()) as {
        uploadUrl: string
        videoId: string
        storageKey: string
        expiresAt: string
      }

      console.log(
        `[UploadManager] Got presigned URL for ${filename}, videoId: ${presignedData.videoId}`
      )

      // Step 2: Upload file directly to Wasabi using presigned URL with progress tracking
      // Note: Video record is NOT created yet - only after upload completes
      const abortController = new AbortController()
      this.activeUploads.set(uploadId, abortController)

      // Update status to uploading
      store.updateStatus(uploadId, 'uploading')
      this.lastProgressTime.set(uploadId, Date.now())

      // Start stall detection if not already running
      this.startStallDetection()

      // Upload with progress tracking
      await uploadWithProgress(
        presignedData.uploadUrl,
        file,
        uploadMetadata.fileType,
        abortController.signal,
        (loaded, total) => {
          // Update progress in store
          const progress = Math.round((loaded / total) * 100)
          store.updateProgress(uploadId, loaded, progress)

          // Update last activity time for stall detection
          this.lastProgressTime.set(uploadId, Date.now())

          console.log(
            `[UploadManager] ${uploadMetadata.fileName}: ${progress}% (${loaded}/${total} bytes)`
          )
        }
      )

      console.log(`[UploadManager] Upload complete ${uploadMetadata.relativePath}`)

      // Step 3: Confirm upload completion - creates video record with status 'processing'
      // This triggers the Supabase INSERT webhook for backend processing
      console.log(`[UploadManager] Confirming upload for videoId: ${presignedData.videoId}`)

      const confirmResponse = await fetch(
        `${supabaseUrl}/functions/v1/captionacc-presigned-upload/confirm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            videoId: presignedData.videoId,
            storageKey: presignedData.storageKey,
            filename,
            contentType: uploadMetadata.fileType,
            sizeBytes: file.size,
            videoPath,
            width: dimensions.width,
            height: dimensions.height,
          }),
        }
      )

      if (!confirmResponse.ok) {
        const errorText = await confirmResponse.text()
        console.error('[UploadManager] Failed to confirm upload:', errorText)
        throw new Error(`Failed to confirm upload: ${confirmResponse.status} ${errorText}`)
      }

      console.log(`[UploadManager] Upload confirmed, video record created with status 'processing'`)

      // Mark as completed
      store.completeUpload(uploadId, presignedData.videoId)

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
      this.retryCount.delete(uploadId)
      this.lastProgressTime.delete(uploadId)

      // Process next in queue
      setTimeout(() => this.processUploadQueue(), 100)
    } catch (error) {
      console.error(`[UploadManager] Failed ${uploadMetadata.relativePath}:`, error)

      // Check if we should retry
      const currentRetryCount = retryCount
      const err = error as Error

      if (currentRetryCount < MAX_RETRIES && isRetryableError(err)) {
        const delay = RETRY_DELAYS[Math.min(currentRetryCount, RETRY_DELAYS.length - 1)]
        console.log(`[UploadManager] Will retry ${uploadMetadata.relativePath} in ${delay}ms`)

        // Update status to show retry
        store.updateStatus(uploadId, 'pending', `Retrying (attempt ${currentRetryCount + 1})`)
        this.retryCount.set(uploadId, currentRetryCount + 1)

        // Schedule retry
        setTimeout(() => {
          void this.createPresignedUpload(uploadId, currentRetryCount + 1)
        }, delay)
      } else {
        // Max retries exceeded or non-retryable error
        store.updateStatus(uploadId, 'error', err.message)
        this.activeUploads.delete(uploadId)
        this.uploadFiles.delete(uploadId)
        this.retryCount.delete(uploadId)
        this.lastProgressTime.delete(uploadId)

        // Process next in queue
        setTimeout(() => this.processUploadQueue(), 100)
      }
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
      const retryCount = this.retryCount.get(upload.id) ?? 0
      void this.createPresignedUpload(upload.id, retryCount)
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
    const abortController = this.activeUploads.get(uploadId)

    if (abortController) {
      abortController.abort()
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

    // Reset retry count
    this.retryCount.delete(uploadId)

    // Reset status to pending
    store.updateStatus(uploadId, 'pending')

    // Process queue (will pick up this upload)
    this.processUploadQueue()
  }

  /**
   * Cancel all active uploads
   */
  async cancelAll(): Promise<void> {
    const uploadIds = Array.from(this.activeUploads.keys())

    // Abort all active uploads
    uploadIds.forEach(id => {
      const controller = this.activeUploads.get(id)
      if (controller) {
        controller.abort()
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
          const controller = this.activeUploads.get(uploadId)
          if (controller) {
            controller.abort()
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
