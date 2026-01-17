/**
 * Hook for managing video CRUD operations.
 * Handles rename and delete video operations along with modal state.
 */

import { useState, useCallback } from 'react'

import { supabase } from '~/services/supabase-client'
import type { RenameVideoModalState, DeleteVideoModalState, ErrorModalState } from '~/types/videos'
import type { BadgeState } from '~/utils/video-badges'

interface UseVideoOperationsParams {
  /** Callback when an operation completes successfully */
  onOperationComplete: () => void
}

interface UseVideoOperationsReturn {
  // Modal states
  renameVideoModal: RenameVideoModalState
  deleteVideoModal: DeleteVideoModalState
  errorModal: ErrorModalState

  // Form states
  renamedVideoName: string
  videoError: string | null
  videoLoading: boolean

  // Modal open handlers
  openRenameVideoModal: (videoPath: string, currentName: string) => void
  openDeleteVideoModal: (videoPath: string, videoName: string) => void
  openErrorModal: (videoId: string, errorDetails: BadgeState['errorDetails']) => void

  // Modal close handlers
  closeRenameVideoModal: () => void
  closeDeleteVideoModal: () => void
  closeErrorModal: () => void

  // Form handlers
  setRenamedVideoName: (name: string) => void

  // Action handlers
  handleRenameVideo: () => Promise<void>
  handleDeleteVideo: () => Promise<void>
}

/**
 * Hook for managing video CRUD operations and modal state.
 */
export function useVideoOperations({
  onOperationComplete,
}: UseVideoOperationsParams): UseVideoOperationsReturn {
  // Modal states
  const [renameVideoModal, setRenameVideoModal] = useState<RenameVideoModalState>({ open: false })
  const [deleteVideoModal, setDeleteVideoModal] = useState<DeleteVideoModalState>({ open: false })
  const [errorModal, setErrorModal] = useState<ErrorModalState>({ open: false })

  // Form states
  const [renamedVideoName, setRenamedVideoName] = useState('')
  const [videoError, setVideoError] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)

  // Modal open handlers
  const openRenameVideoModal = useCallback((videoPath: string, currentName: string) => {
    setRenameVideoModal({ open: true, videoPath, currentName })
    setRenamedVideoName(currentName)
    setVideoError(null)
    setVideoLoading(false)
  }, [])

  const openDeleteVideoModal = useCallback(
    (videoId: string, videoName: string, videoPath: string) => {
      setDeleteVideoModal({ open: true, videoId, videoName, videoPath })
    },
    []
  )

  const openErrorModal = useCallback(
    (videoId: string, errorDetails: BadgeState['errorDetails']) => {
      setErrorModal({ open: true, errorDetails, videoId })
    },
    []
  )

  // Modal close handlers
  const closeRenameVideoModal = useCallback(() => {
    setRenameVideoModal({ open: false })
  }, [])

  const closeDeleteVideoModal = useCallback(() => {
    setDeleteVideoModal({ open: false })
  }, [])

  const closeErrorModal = useCallback(() => {
    setErrorModal({ open: false })
  }, [])

  // Action handlers
  const handleRenameVideo = useCallback(async () => {
    if (!renameVideoModal.videoPath) return

    setVideoError(null)
    setVideoLoading(true)

    try {
      const oldPath = renameVideoModal.videoPath
      const pathParts = oldPath.split('/')
      pathParts[pathParts.length - 1] = renamedVideoName
      const newPath = pathParts.join('/')

      // Update video display_path in Supabase (video_path stays as original, storage_key never changes)
      const { error } = await supabase
        .from('videos')
        .update({
          display_path: newPath,
        })
        .eq('display_path', oldPath)
        .is('deleted_at', null)

      if (error) {
        console.error('Failed to rename video:', error)
        setVideoError(error.message ?? 'Failed to rename video')
        setVideoLoading(false)
        return
      }

      // Success - close modal and reload
      setVideoLoading(false)
      setRenameVideoModal({ open: false })
      setRenamedVideoName('')
      onOperationComplete()
    } catch (error) {
      console.error('Rename video error:', error)
      setVideoError('Network error')
      setVideoLoading(false)
    }
  }, [renameVideoModal.videoPath, renamedVideoName, onOperationComplete])

  const handleDeleteVideo = useCallback(async () => {
    if (!deleteVideoModal.videoId) return

    setVideoError(null)
    setVideoLoading(true)

    try {
      const videoId = deleteVideoModal.videoId
      const videoPath = deleteVideoModal.videoPath

      // Soft delete by setting deleted_at timestamp
      const { data, error } = await supabase
        .from('videos')
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq('id', videoId)
        .is('deleted_at', null)
        .select()

      if (error) {
        console.error('Failed to delete video:', error)
        setVideoError(error.message ?? 'Failed to delete video')
        setVideoLoading(false)
        return
      }

      // Check if any rows were actually updated
      if (!data || data.length === 0) {
        console.error('Delete failed: No video found with ID:', videoId)
        setVideoError('Video not found or already deleted')
        setVideoLoading(false)
        return
      }

      console.log('Successfully deleted video:', videoId, 'Updated rows:', data.length)

      // Success - close modal and reload
      setVideoLoading(false)
      setDeleteVideoModal({ open: false })

      onOperationComplete()
    } catch (error) {
      console.error('Delete video error:', error)
      setVideoError('Network error')
      setVideoLoading(false)
    }
  }, [deleteVideoModal.videoId, deleteVideoModal.videoPath, onOperationComplete])

  return {
    // Modal states
    renameVideoModal,
    deleteVideoModal,
    errorModal,

    // Form states
    renamedVideoName,
    videoError,
    videoLoading,

    // Modal open handlers
    openRenameVideoModal,
    openDeleteVideoModal,
    openErrorModal,

    // Modal close handlers
    closeRenameVideoModal,
    closeDeleteVideoModal,
    closeErrorModal,

    // Form handlers
    setRenamedVideoName,

    // Action handlers
    handleRenameVideo,
    handleDeleteVideo,
  }
}
