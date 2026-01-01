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

  // Subscribe to upload progress from store
  const uploads = useAppStore(state => state.uploads)

  /**
   * Sync upload progress from store back to videoFiles array
   */
  useEffect(() => {
    if (uploadIdMapRef.current.size === 0) return

    setVideoFiles(prev =>
      prev.map(videoFile => {
        const uploadId = uploadIdMapRef.current.get(videoFile.relativePath)
        if (!uploadId) return videoFile

        const uploadState = uploads[uploadId]
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
        }
      })
    )
  }, [uploads, setVideoFiles])

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
   */
  useEffect(() => {
    if (!uploading) return
    if (uploadIdMapRef.current.size === 0) return

    // Check if all tracked uploads are complete
    const allComplete = Array.from(uploadIdMapRef.current.values()).every(uploadId => {
      const uploadState = uploads[uploadId]
      return (
        uploadState &&
        (uploadState.status === 'completed' ||
          uploadState.status === 'failed' ||
          uploadState.status === 'cancelled')
      )
    })

    if (allComplete) {
      console.log('[useUploadQueueV2] All uploads complete')
      setUploading(false)
    }
  }, [uploads, uploading])

  /**
   * Stop queued uploads (keep active ones running)
   */
  const handleStopQueued = useCallback(() => {
    console.log('[useUploadQueueV2] Stopping queued uploads...')

    // Cancel uploads that are still pending
    uploadIdMapRef.current.forEach((uploadId, _relativePath) => {
      const uploadState = uploads[uploadId]
      if (uploadState?.status === 'pending') {
        void uploadManager.cancelUpload(uploadId)
      }
    })

    setShowStopQueuedModal(false)
  }, [uploads])

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

  return {
    uploading,
    showStopQueuedModal,
    showAbortAllModal,
    setShowStopQueuedModal,
    setShowAbortAllModal,
    startUpload,
    handleStopQueued,
    handleAbortAll,
  }
}
