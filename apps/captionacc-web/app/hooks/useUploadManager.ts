/**
 * Hook for integrating UploadManager service with React components
 *
 * This hook provides a React-friendly interface to the UploadManager singleton,
 * allowing components to start uploads, track progress, and manage upload lifecycle.
 */

import { useCallback, useEffect } from 'react'

import { uploadManager } from '~/services/upload-manager'
import { useAppStore, selectActiveUploads, selectIncompleteUploads } from '~/stores/app-store'
import type { UploadMetadata } from '~/types/store'
import type { VideoFilePreview } from '~/types/upload'

interface UseUploadManagerResult {
  /** Active uploads from store */
  activeUploads: UploadMetadata[]

  /** Incomplete uploads that can be resumed */
  incompleteUploads: UploadMetadata[]

  /** Start upload for a file */
  startUpload: (
    file: File,
    metadata: {
      fileName: string
      fileType: string
      targetFolder: string | null
      relativePath: string
    }
  ) => Promise<string>

  /** Resume an incomplete upload */
  resumeUpload: (uploadId: string, file: File) => Promise<void>

  /** Cancel a specific upload */
  cancelUpload: (uploadId: string) => Promise<void>

  /** Cancel all active uploads */
  cancelAll: () => Promise<void>

  /** Clear completed uploads from store */
  clearCompleted: () => void

  /** Get active upload count */
  activeCount: number
}

/**
 * Hook for managing uploads using the UploadManager service
 */
export function useUploadManager(): UseUploadManagerResult {
  // Subscribe to store
  const activeUploads = useAppStore(selectActiveUploads)
  const incompleteUploads = useAppStore(selectIncompleteUploads)
  const clearCompletedUploads = useAppStore(state => state.clearCompletedUploads)

  // Wrap UploadManager methods
  const startUpload = useCallback(
    async (
      file: File,
      metadata: {
        fileName: string
        fileType: string
        targetFolder: string | null
        relativePath: string
      }
    ) => {
      return uploadManager.startUpload(file, metadata)
    },
    []
  )

  const resumeUpload = useCallback(async (uploadId: string, file: File) => {
    return uploadManager.resumeUpload(uploadId, file)
  }, [])

  const cancelUpload = useCallback(async (uploadId: string) => {
    return uploadManager.cancelUpload(uploadId)
  }, [])

  const cancelAll = useCallback(async () => {
    return uploadManager.cancelAll()
  }, [])

  const clearCompleted = useCallback(() => {
    clearCompletedUploads()
  }, [clearCompletedUploads])

  // Get active count
  const activeCount = uploadManager.getActiveUploadCount()

  return {
    activeUploads,
    incompleteUploads,
    startUpload,
    resumeUpload,
    cancelUpload,
    cancelAll,
    clearCompleted,
    activeCount,
  }
}

/**
 * Hook for batch uploading multiple files (convenience wrapper)
 */
export function useBatchUpload(targetFolder: string | null) {
  const { startUpload } = useUploadManager()

  const uploadFiles = useCallback(
    async (files: VideoFilePreview[]) => {
      const selectedFiles = files.filter(f => f.selected)

      console.log(`[useBatchUpload] Starting upload for ${selectedFiles.length} files`)

      const uploadPromises = selectedFiles.map(filePreview =>
        startUpload(filePreview.file, {
          fileName: filePreview.file.name,
          fileType: filePreview.file.type,
          targetFolder,
          relativePath: filePreview.relativePath,
        })
      )

      return Promise.all(uploadPromises)
    },
    [startUpload, targetFolder]
  )

  return { uploadFiles }
}

/**
 * Hook for detecting and prompting for incomplete upload resume
 */
export function useIncompleteUploadDetection() {
  const incompleteUploads = useAppStore(selectIncompleteUploads)

  useEffect(() => {
    // On mount, check for incomplete uploads
    if (incompleteUploads.length > 0) {
      console.log(
        `[useIncompleteUploadDetection] Found ${incompleteUploads.length} incomplete uploads`
      )

      // Show notification or prompt to user
      // (Implementation depends on notification system)
    }
  }, []) // Only run on mount

  return {
    incompleteUploads,
    hasIncomplete: incompleteUploads.length > 0,
  }
}
