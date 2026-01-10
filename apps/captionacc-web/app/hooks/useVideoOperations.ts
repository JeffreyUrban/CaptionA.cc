/**
 * Hook for managing video CRUD operations.
 * Handles rename and delete video operations along with modal state.
 */

import { useState, useCallback } from 'react'

import { supabase } from '~/services/supabase-client'
import type { RenameVideoModalState, DeleteVideoModalState, ErrorModalState } from '~/types/videos'
import type { BadgeState } from '~/utils/video-stats'

interface UseVideoOperationsParams {
  /** Callback when an operation completes successfully */
  onOperationComplete: () => void
  /** Callback to clear stats for a deleted video */
  clearVideoStats?: (videoId: string) => void
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
  clearVideoStats,
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

  const openDeleteVideoModal = useCallback((videoPath: string, videoName: string) => {
    setDeleteVideoModal({ open: true, videoPath, videoName })
  }, [])

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

      // Get the current session for auth token
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch('/api/videos/rename', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ oldPath, newName: renamedVideoName }),
      })

      const data = await response.json()

      if (!response.ok) {
        setVideoError(data.error ?? 'Failed to rename video')
        setVideoLoading(false)
        return
      }

      // Success - close modal and reload
      setVideoLoading(false)
      setRenameVideoModal({ open: false })
      setRenamedVideoName('')
      onOperationComplete()
    } catch {
      setVideoError('Network error')
      setVideoLoading(false)
    }
  }, [renameVideoModal.videoPath, renamedVideoName, onOperationComplete])

  const handleDeleteVideo = useCallback(async () => {
    if (!deleteVideoModal.videoPath) return

    setVideoError(null)
    setVideoLoading(true)

    try {
      const videoPath = deleteVideoModal.videoPath

      // Get the current session for auth token
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(`/api/videos/${encodeURIComponent(videoPath)}/delete`, {
        method: 'DELETE',
        headers,
      })

      const data = await response.json()

      if (!response.ok) {
        setVideoError(data.error ?? 'Failed to delete video')
        setVideoLoading(false)
        return
      }

      // Clear cached stats FIRST, before state updates trigger re-renders
      if (clearVideoStats) {
        clearVideoStats(videoPath)
      }

      // Success - close modal and reload
      setVideoLoading(false)
      setDeleteVideoModal({ open: false })
      onOperationComplete()
    } catch {
      setVideoError('Network error')
      setVideoLoading(false)
    }
  }, [deleteVideoModal.videoPath, onOperationComplete, clearVideoStats])

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
