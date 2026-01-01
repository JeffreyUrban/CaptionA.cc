/**
 * Hook for detecting and handling incomplete uploads from the Zustand store.
 *
 * This V2 version uses the global state store instead of API endpoints,
 * allowing uploads to be resumed after page refresh.
 */

import { useState, useEffect, useCallback } from 'react'

import { useAppStore, selectIncompleteUploads } from '~/stores/app-store'
import type { UploadMetadata } from '~/types/store'
import type { IncompleteUpload } from '~/types/upload'

interface UseIncompleteUploadsV2Result {
  incompleteUploads: IncompleteUpload[]
  showIncompletePrompt: boolean
  dismissIncompletePrompt: () => void
  clearIncompleteUploads: () => void
}

/**
 * Convert UploadMetadata to IncompleteUpload format for UI compatibility
 */
function convertToIncompleteUpload(upload: UploadMetadata): IncompleteUpload {
  return {
    uploadId: upload.id,
    videoId: upload.id, // Using upload ID as video ID for now
    videoPath: upload.relativePath,
    filename: upload.fileName,
    uploadLength: upload.fileSize,
    currentSize: upload.bytesUploaded,
    progress: upload.progress,
    createdAt: new Date(upload.createdAt).toISOString(),
  }
}

/**
 * Hook for detecting incomplete uploads from the global store.
 *
 * Checks for uploads that were in progress when the page was closed,
 * and offers to resume or clear them.
 *
 * @returns Incomplete upload state and control handlers
 */
export function useIncompleteUploadsV2(): UseIncompleteUploadsV2Result {
  const incompleteUploadsFromStore = useAppStore(selectIncompleteUploads)
  const clearCompletedUploads = useAppStore(state => state.clearCompletedUploads)
  const removeUpload = useAppStore(state => state.removeUpload)

  const [showIncompletePrompt, setShowIncompletePrompt] = useState(false)
  const [hasChecked, setHasChecked] = useState(false)

  // Convert to UI format
  const incompleteUploads = incompleteUploadsFromStore.map(convertToIncompleteUpload)

  // Check for incomplete uploads on mount (only once)
  useEffect(() => {
    if (hasChecked) return

    if (incompleteUploadsFromStore.length > 0) {
      console.log(
        `[Upload] Found ${incompleteUploadsFromStore.length} incomplete upload(s) from previous session`
      )
      setShowIncompletePrompt(true)
    }

    setHasChecked(true)
  }, [incompleteUploadsFromStore.length, hasChecked])

  const dismissIncompletePrompt = useCallback(() => {
    setShowIncompletePrompt(false)
  }, [])

  const clearIncompleteUploads = useCallback(() => {
    console.log('[Upload] Clearing incomplete uploads')

    // Remove all incomplete uploads from store
    incompleteUploadsFromStore.forEach(upload => {
      removeUpload(upload.id)
    })

    // Also clear any completed uploads
    clearCompletedUploads()

    setShowIncompletePrompt(false)
  }, [incompleteUploadsFromStore, removeUpload, clearCompletedUploads])

  return {
    incompleteUploads,
    showIncompletePrompt,
    dismissIncompletePrompt,
    clearIncompleteUploads,
  }
}
