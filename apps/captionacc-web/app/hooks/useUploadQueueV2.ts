/**
 * Upload Queue Hook V2 - Bridge between Upload Manager and existing UI
 *
 * This hook provides the same interface as useUploadQueue but uses the new
 * UploadManager service internally. It syncs upload progress from the Zustand
 * store back to the videoFiles array so existing UI components continue to work.
 *
 * This is a compatibility layer to enable gradual migration to the new architecture.
 */

import { useState, useCallback, useEffect, useRef } from 'react'

import { uploadManager } from '~/services/upload-manager'
import { useAppStore } from '~/stores/app-store'
import type { VideoFilePreview } from '~/types/upload'

interface UseUploadQueueV2Result {
  uploading: boolean
  showStopQueuedModal: boolean
  showAbortAllModal: boolean
  setShowStopQueuedModal: (show: boolean) => void
  setShowAbortAllModal: (show: boolean) => void
  startUpload: () => void
  handleStopQueued: () => void
  handleAbortAll: () => void
  resetUploadState: () => void
}

/**
 * Hook for managing TUS upload queue with new UploadManager service
 *
 * @param videoFiles - Array of video files to upload
 * @param setVideoFiles - State setter for video files
 * @param selectedFolder - Target folder for uploads
 * @returns Upload control functions and state
 */
export function useUploadQueueV2(
  videoFiles: VideoFilePreview[],
  setVideoFiles: React.Dispatch<React.SetStateAction<VideoFilePreview[]>>,
  selectedFolder: string
): UseUploadQueueV2Result {
  const [uploading, setUploading] = useState(false)
  const [showStopQueuedModal, setShowStopQueuedModal] = useState(false)
  const [showAbortAllModal, setShowAbortAllModal] = useState(false)

  // Track which videoFiles have been started in UploadManager
  const uploadIdMapRef = useRef<Map<string, string>>(new Map()) // relativePath -> uploadId

  /**
   * On mount, clean up stale/corrupted uploads and restore valid pending duplicates
   */
  useEffect(() => {
    const store = useAppStore.getState()
    const currentUploads = store.uploads
    const now = Date.now()
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000

    // Clean up stale/corrupted uploads
    const uploadsToRemove: string[] = []
    Object.values(currentUploads).forEach(upload => {
      // Remove uploads older than 1 week
      if (now - upload.createdAt > ONE_WEEK) {
        console.log(
          `[useUploadQueueV2] Removing stale upload (>1 week old): ${upload.relativePath}`
        )
        uploadsToRemove.push(upload.id)
        return
      }

      // Remove corrupted duplicates (missing required fields)
      if (upload.isDuplicate && (!upload.videoId || !upload.duplicateOfVideoId)) {
        console.log(
          `[useUploadQueueV2] Removing corrupted duplicate (missing IDs): ${upload.relativePath}`
        )
        uploadsToRemove.push(upload.id)
        return
      }

      // Remove failed/cancelled uploads (no need to keep them)
      if (upload.status === 'failed' || upload.status === 'cancelled') {
        console.log(`[useUploadQueueV2] Removing ${upload.status} upload: ${upload.relativePath}`)
        uploadsToRemove.push(upload.id)
        return
      }
    })

    // Clean up the identified uploads
    uploadsToRemove.forEach(id => store.removeUpload(id))

    if (uploadsToRemove.length > 0) {
      console.log(`[useUploadQueueV2] Cleaned up ${uploadsToRemove.length} stale/corrupted uploads`)
    }

    // Restore valid pending duplicates
    const uploadsWithDuplicates = Object.values(store.uploads).filter(
      upload => upload.status === 'completed' && upload.isDuplicate && upload.videoId
    )

    if (uploadsWithDuplicates.length > 0) {
      console.log(
        '[useUploadQueueV2] Restoring',
        uploadsWithDuplicates.length,
        'valid pending duplicates'
      )

      setVideoFiles(prev => {
        // Create VideoFilePreview entries for uploads not already in the array
        const existingPaths = new Set(prev.map(v => v.relativePath))
        const newFiles: VideoFilePreview[] = uploadsWithDuplicates
          .filter(upload => !existingPaths.has(upload.relativePath))
          .map(upload => ({
            file: new File([], upload.fileName, { type: upload.fileType }),
            relativePath: upload.relativePath,
            size: upload.fileSize,
            type: upload.fileType,
            selected: true,
            uploadProgress: 100,
            uploadStatus: 'complete',
            uploadId: upload.id,
            uploadUrl: upload.uploadUrl ?? undefined,
            videoId: upload.videoId ?? undefined,
            pendingDuplicateResolution: true,
            duplicateOfVideoId: upload.duplicateOfVideoId ?? undefined,
            duplicateOfDisplayPath: upload.duplicateOfDisplayPath ?? undefined,
          }))

        console.log(
          '[useUploadQueueV2] Adding',
          newFiles.length,
          'valid duplicates (skipped',
          uploadsWithDuplicates.length - newFiles.length,
          'already present)'
        )
        return [...prev, ...newFiles]
      })

      // Map uploadIds
      uploadsWithDuplicates.forEach(upload => {
        uploadIdMapRef.current.set(upload.relativePath, upload.id)
      })
    }
  }, []) // Run once on mount

  /**
   * Sync upload progress from store back to videoFiles array
   * Uses polling instead of store subscription to avoid infinite loops
   */
  useEffect(() => {
    // Only poll when uploads are active
    if (!uploading) return

    const syncProgress = () => {
      // Skip if no uploads tracked yet (async startUpload calls may not have completed)
      if (uploadIdMapRef.current.size === 0) return

      const currentUploads = useAppStore.getState().uploads

      setVideoFiles(prev =>
        prev.map(videoFile => {
          const uploadId = uploadIdMapRef.current.get(videoFile.relativePath)
          if (!uploadId) return videoFile

          const uploadState = currentUploads[uploadId]
          if (!uploadState) return videoFile

          // Map store state to VideoFilePreview state
          return {
            ...videoFile,
            uploadProgress: uploadState.progress,
            uploadStatus:
              uploadState.status === 'completed'
                ? ('complete' as const)
                : uploadState.status === 'failed'
                  ? ('error' as const)
                  : uploadState.status === 'cancelled'
                    ? ('error' as const)
                    : uploadState.status === 'uploading'
                      ? ('uploading' as const)
                      : ('pending' as const),
            error: uploadState.error ?? undefined,
            uploadUrl: uploadState.uploadUrl ?? undefined,
            videoId: uploadState.videoId ?? undefined,
            // Include duplicate info from upload manager
            pendingDuplicateResolution: uploadState.isDuplicate,
            duplicateOfVideoId: uploadState.duplicateOfVideoId ?? undefined,
            duplicateOfDisplayPath: uploadState.duplicateOfDisplayPath ?? undefined,
          }
        })
      )
    }

    // Poll every 100ms while uploads are active
    const interval = setInterval(syncProgress, 100)
    return () => clearInterval(interval)
  }, [uploading])

  /**
   * Clean up uploadIdMapRef when uploads are removed from store
   * This prevents stale references to deleted uploads
   */
  useEffect(() => {
    const currentUploads = useAppStore.getState().uploads

    // Remove mappings for uploads that no longer exist in store
    const keysToDelete: string[] = []
    uploadIdMapRef.current.forEach((uploadId, relativePath) => {
      if (!currentUploads[uploadId]) {
        keysToDelete.push(relativePath)
      }
    })

    keysToDelete.forEach(key => {
      console.log(`[useUploadQueueV2] Cleaning up stale mapping: ${key}`)
      uploadIdMapRef.current.delete(key)
    })

    // If all uploads are removed and we're still in uploading state, stop uploading
    if (uploading && uploadIdMapRef.current.size === 0) {
      console.log('[useUploadQueueV2] All uploads removed, stopping upload state')
      setUploading(false)
    }
  }, [videoFiles, uploading])

  /**
   * Start upload process for all selected files
   */
  const startUpload = useCallback(() => {
    void (async () => {
      const selectedFiles = videoFiles.filter(v => v.selected)

      if (selectedFiles.length === 0) {
        console.warn('[useUploadQueueV2] No files selected for upload')
        return
      }

      console.log(`[useUploadQueueV2] Starting upload for ${selectedFiles.length} files`)
      setUploading(true)

      // Start all uploads in UploadManager
      const uploadPromises = selectedFiles.map(async videoFile => {
        try {
          const uploadId = await uploadManager.startUpload(videoFile.file, {
            fileName: videoFile.file.name,
            fileType: videoFile.file.type,
            targetFolder: selectedFolder,
            relativePath: videoFile.relativePath,
          })

          // Track mapping
          uploadIdMapRef.current.set(videoFile.relativePath, uploadId)

          return uploadId
        } catch (error) {
          console.error(
            `[useUploadQueueV2] Failed to start upload for ${videoFile.relativePath}:`,
            error
          )
          return null
        }
      })

      await Promise.all(uploadPromises)

      // Note: uploading state will be managed by monitoring store uploads
      // We'll set it to false when all uploads complete
    })()
  }, [videoFiles, selectedFolder])

  /**
   * Monitor upload completion
   * Uses polling to check completion status instead of store subscription
   */
  useEffect(() => {
    if (!uploading || uploadIdMapRef.current.size === 0) return

    const checkCompletion = () => {
      const currentUploads = useAppStore.getState().uploads

      // Check if all tracked uploads are complete
      const allComplete = Array.from(uploadIdMapRef.current.values()).every(uploadId => {
        const uploadState = currentUploads[uploadId]
        // If upload was removed from store (e.g., duplicate resolution), consider it done
        if (!uploadState) return true
        return (
          uploadState.status === 'completed' ||
          uploadState.status === 'failed' ||
          uploadState.status === 'cancelled'
        )
      })

      if (allComplete) {
        console.log('[useUploadQueueV2] All uploads complete')

        // Do one final sync to ensure completion status reaches the UI
        setVideoFiles(prev =>
          prev.map(videoFile => {
            const uploadId = uploadIdMapRef.current.get(videoFile.relativePath)
            if (!uploadId) return videoFile

            const uploadState = currentUploads[uploadId]
            if (!uploadState) return videoFile

            // Map store state to VideoFilePreview state
            return {
              ...videoFile,
              uploadProgress: uploadState.progress,
              uploadStatus:
                uploadState.status === 'completed'
                  ? ('complete' as const)
                  : uploadState.status === 'failed'
                    ? ('error' as const)
                    : uploadState.status === 'cancelled'
                      ? ('error' as const)
                      : uploadState.status === 'uploading'
                        ? ('uploading' as const)
                        : ('pending' as const),
              error: uploadState.error ?? undefined,
              uploadUrl: uploadState.uploadUrl ?? undefined,
              videoId: uploadState.videoId ?? undefined,
              // Include duplicate info from upload manager
              pendingDuplicateResolution: uploadState.isDuplicate,
              duplicateOfVideoId: uploadState.duplicateOfVideoId ?? undefined,
              duplicateOfDisplayPath: uploadState.duplicateOfDisplayPath ?? undefined,
            }
          })
        )

        setUploading(false)
      }
    }

    // Check every second
    const interval = setInterval(checkCompletion, 1000)
    return () => clearInterval(interval)
  }, [uploading])

  /**
   * Stop queued uploads (keep active ones running)
   */
  const handleStopQueued = useCallback(() => {
    console.log('[useUploadQueueV2] Stopping queued uploads...')

    const currentUploads = useAppStore.getState().uploads

    // Cancel uploads that are still pending
    uploadIdMapRef.current.forEach((uploadId, _relativePath) => {
      const uploadState = currentUploads[uploadId]
      if (uploadState?.status === 'pending') {
        void uploadManager.cancelUpload(uploadId)
      }
    })

    setShowStopQueuedModal(false)
  }, [])

  /**
   * Abort all uploads including active ones
   */
  const handleAbortAll = useCallback(() => {
    console.log('[useUploadQueueV2] Aborting all uploads...')

    // Cancel all tracked uploads
    uploadIdMapRef.current.forEach(uploadId => {
      void uploadManager.cancelUpload(uploadId)
    })

    // Clear tracking
    uploadIdMapRef.current.clear()

    setUploading(false)
    setShowAbortAllModal(false)
  }, [])

  /**
   * Warn user before closing/navigating during uploads
   */
  useEffect(() => {
    if (!uploading) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = 'Uploads in progress. Are you sure you want to leave?'
      return 'Uploads in progress. Are you sure you want to leave?'
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [uploading])

  /**
   * Reset upload state (called when clicking "Upload More Videos")
   */
  const resetUploadState = useCallback(() => {
    console.log('[useUploadQueueV2] Resetting upload state')
    setUploading(false)
    uploadIdMapRef.current.clear()
  }, [])

  return {
    uploading,
    showStopQueuedModal,
    showAbortAllModal,
    setShowStopQueuedModal,
    setShowAbortAllModal,
    startUpload,
    handleStopQueued,
    handleAbortAll,
    resetUploadState,
  }
}
