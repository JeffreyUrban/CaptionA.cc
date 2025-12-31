/**
 * Hook for managing the TUS upload queue and orchestration.
 * Handles concurrent uploads, retries, stall detection, and cancellation.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import * as tus from 'tus-js-client'

import type { VideoFilePreview } from '~/types/upload'
import {
  CONCURRENT_UPLOADS,
  CHUNK_SIZE,
  RETRY_DELAYS,
  MAX_RETRIES,
  STALL_TIMEOUT,
} from '~/types/upload'
import { isRetryableError } from '~/utils/upload-helpers'

interface UseUploadQueueResult {
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
 * Hook for managing TUS upload queue with concurrent uploads, retries, and cancellation.
 *
 * @param videoFiles - Array of video files to upload
 * @param setVideoFiles - State setter for video files
 * @param selectedFolder - Target folder for uploads
 * @param onUploadComplete - Callback when all uploads complete
 * @returns Upload control functions and state
 */
export function useUploadQueue(
  videoFiles: VideoFilePreview[],
  setVideoFiles: React.Dispatch<React.SetStateAction<VideoFilePreview[]>>,
  selectedFolder: string,
  onUploadComplete?: () => void
): UseUploadQueueResult {
  const [uploading, setUploading] = useState(false)
  const [showStopQueuedModal, setShowStopQueuedModal] = useState(false)
  const [showAbortAllModal, setShowAbortAllModal] = useState(false)

  // Track active TUS upload instances for abortion
  const activeUploadsRef = useRef<Map<string, tus.Upload>>(new Map())

  /**
   * Save upload progress to localStorage for potential recovery
   */
  const saveUploadProgress = useCallback(() => {
    const progress = videoFiles.map(v => ({
      relativePath: v.relativePath,
      uploadProgress: v.uploadProgress,
      uploadStatus: v.uploadStatus,
      error: v.error,
    }))
    localStorage.setItem('upload-progress', JSON.stringify(progress))
  }, [videoFiles])

  /**
   * Start a single file upload with TUS protocol
   */
  const startSingleUpload = useCallback(
    (index: number, retryCount: number = 0) => {
      const video = videoFiles[index]
      if (!video) return

      // Extract video path from relative path
      const pathParts = video.relativePath.split('/')
      const filename = pathParts[pathParts.length - 1]
      if (!filename) {
        console.error(`[Upload] Invalid filename for ${video.relativePath}`)
        return
      }

      let videoPath = pathParts
        .slice(0, -1)
        .concat(filename.replace(/\.\w+$/, ''))
        .join('/')

      // Prepend selected folder if any
      if (selectedFolder) {
        videoPath = selectedFolder + '/' + videoPath
      }

      const videoId = `video-${index}`
      console.log(
        `[Upload] Starting ${video.relativePath} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`
      )

      const upload = new tus.Upload(video.file, {
        endpoint: '/api/upload',
        retryDelays: RETRY_DELAYS,
        chunkSize: CHUNK_SIZE,
        uploadUrl: video.uploadUrl, // Resume from previous attempt if available
        metadata: {
          filename: filename,
          filetype: video.file.type,
          videoPath: videoPath,
        },
        onError: error => {
          console.error(`[Upload] Failed ${video.relativePath}:`, error)

          // Check if we should retry
          if (retryCount < MAX_RETRIES && isRetryableError(error)) {
            const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
            console.log(
              `[Upload] Will retry ${video.relativePath} in ${delay}ms (attempt ${retryCount + 1})`
            )

            setVideoFiles(prev =>
              prev.map((v, i) =>
                i === index
                  ? {
                      ...v,
                      uploadStatus: 'retrying',
                      error: `Retrying... (attempt ${retryCount + 1}/${MAX_RETRIES})`,
                      retryCount: retryCount + 1,
                    }
                  : v
              )
            )

            // Schedule retry
            setTimeout(() => {
              startSingleUpload(index, retryCount + 1)
            }, delay)
          } else {
            // Max retries exceeded or non-retryable error
            setVideoFiles(prev =>
              prev.map((v, i) =>
                i === index
                  ? {
                      ...v,
                      uploadStatus: 'error',
                      error: error.message,
                      retryCount: retryCount + 1,
                    }
                  : v
              )
            )
            activeUploadsRef.current.delete(videoId)

            // Process next in queue
            setTimeout(() => processUploadQueue(), 100)
          }
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const progress = (bytesUploaded / bytesTotal) * 100
          setVideoFiles(prev =>
            prev.map((v, i) =>
              i === index
                ? {
                    ...v,
                    uploadProgress: progress,
                    lastActivityAt: Date.now(),
                  }
                : v
            )
          )
        },
        onSuccess: () => {
          console.log(`[Upload] Complete ${video.relativePath}`)
          setVideoFiles(prev =>
            prev.map((v, i) =>
              i === index ? { ...v, uploadStatus: 'complete', uploadProgress: 100 } : v
            )
          )
          activeUploadsRef.current.delete(videoId)
          saveUploadProgress()

          // Process next in queue
          setTimeout(() => processUploadQueue(), 100)

          // Check if all done
          const allSelected = videoFiles.filter(v => v.selected)
          const allComplete = allSelected.every(
            v => v.uploadStatus === 'complete' || v.uploadStatus === 'error'
          )
          if (allComplete) {
            setUploading(false)
            onUploadComplete?.()
          }
        },
        onAfterResponse: (_req, res) => {
          // Store upload URL for resumability
          const uploadUrl = res.getHeader('Location')
          if (uploadUrl) {
            setVideoFiles(prev => prev.map((v, i) => (i === index ? { ...v, uploadUrl } : v)))
          }
        },
      })

      upload.start()
      activeUploadsRef.current.set(videoId, upload)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- processUploadQueue is defined below and uses setVideoFiles internally
    [videoFiles, selectedFolder, setVideoFiles, saveUploadProgress, onUploadComplete]
  )

  /**
   * Process the upload queue - start uploads for available slots
   */
  const processUploadQueue = useCallback(() => {
    setVideoFiles(prev => {
      const newFiles = [...prev]

      // Count active uploads
      const activeCount = newFiles.filter(
        v => v.uploadStatus === 'uploading' || v.uploadStatus === 'retrying'
      ).length

      // Calculate available slots
      const availableSlots = CONCURRENT_UPLOADS - activeCount
      if (availableSlots <= 0) return prev

      // Find videos ready to upload
      const readyToUpload = newFiles
        .map((v, idx) => ({ video: v, index: idx }))
        .filter(
          ({ video }) =>
            video.selected && (video.uploadStatus === 'pending' || video.uploadStatus === 'stalled')
        )
        .slice(0, availableSlots)

      // Start uploads for available slots
      readyToUpload.forEach(({ video, index }) => {
        startSingleUpload(index, video.retryCount ?? 0)
        newFiles[index] = {
          ...video,
          uploadStatus: 'uploading' as const,
          lastActivityAt: Date.now(),
        }
      })

      return newFiles
    })
  }, [setVideoFiles, startSingleUpload])

  /**
   * Start the upload process
   */
  const startUpload = useCallback(() => {
    setUploading(true)

    console.log(
      `[startUpload] Starting upload for ${videoFiles.filter(f => f.selected).length} videos`
    )

    // Mark all as pending (not queued yet)
    setVideoFiles(prev =>
      prev.map(v => (v.selected ? { ...v, uploadStatus: 'pending' as const, retryCount: 0 } : v))
    )

    // Start processing queue
    processUploadQueue()
  }, [videoFiles, setVideoFiles, processUploadQueue])

  /**
   * Stop queued uploads (keep active ones running)
   */
  const handleStopQueued = useCallback(() => {
    console.log('[Upload] Stopping queued uploads...')

    // Mark all pending uploads as cancelled
    setVideoFiles(prev =>
      prev.map(v =>
        v.uploadStatus === 'pending' || v.uploadStatus === 'stalled'
          ? { ...v, uploadStatus: 'error' as const, error: 'Cancelled by user' }
          : v
      )
    )

    setShowStopQueuedModal(false)
  }, [setVideoFiles])

  /**
   * Abort all uploads including active ones
   */
  const handleAbortAll = useCallback(() => {
    console.log('[Upload] Aborting all uploads...')

    // Abort active uploads
    activeUploadsRef.current.forEach(upload => {
      void upload.abort()
    })
    activeUploadsRef.current.clear()

    // Mark all non-complete uploads as cancelled
    setVideoFiles(prev =>
      prev.map(v =>
        v.uploadStatus !== 'complete'
          ? { ...v, uploadStatus: 'error' as const, error: 'Cancelled by user' }
          : v
      )
    )

    setUploading(false)
    setShowAbortAllModal(false)
  }, [setVideoFiles])

  // Stall detection - check for uploads with no progress
  useEffect(() => {
    if (!uploading) return

    const interval = setInterval(() => {
      const now = Date.now()
      setVideoFiles(prev =>
        prev.map(v => {
          if (v.uploadStatus === 'uploading' && v.lastActivityAt) {
            const timeSinceActivity = now - v.lastActivityAt
            if (timeSinceActivity > STALL_TIMEOUT) {
              console.warn(
                `[Upload] Stalled ${v.relativePath} (no activity for ${timeSinceActivity}ms)`
              )
              // Mark as stalled so it can be retried
              return { ...v, uploadStatus: 'stalled' as const, error: 'Upload stalled' }
            }
          }
          return v
        })
      )

      // Trigger queue processing to pick up stalled uploads
      processUploadQueue()
    }, 10000) // Check every 10 seconds

    return () => clearInterval(interval)
  }, [uploading, setVideoFiles, processUploadQueue])

  // Warn user before closing/navigating during uploads
  useEffect(() => {
    const hasActiveUploads = videoFiles.some(
      v =>
        v.uploadStatus === 'uploading' ||
        v.uploadStatus === 'retrying' ||
        v.uploadStatus === 'pending' ||
        v.uploadStatus === 'stalled'
    )

    if (!hasActiveUploads) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [videoFiles])

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
