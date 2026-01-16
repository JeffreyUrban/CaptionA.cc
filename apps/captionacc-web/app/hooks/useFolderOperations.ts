/**
 * Hook for managing folder CRUD operations.
 * Handles create, rename, and delete folder operations along with modal state.
 */

import { useState, useCallback } from 'react'

import { supabase } from '~/services/supabase-client'
import type {
  CreateFolderModalState,
  RenameFolderModalState,
  DeleteFolderModalState,
} from '~/types/videos'

interface UseFolderOperationsParams {
  /** Callback when an operation completes successfully */
  onOperationComplete: () => void
}

interface UseFolderOperationsReturn {
  // Modal states
  createFolderModal: CreateFolderModalState
  renameFolderModal: RenameFolderModalState
  deleteFolderModal: DeleteFolderModalState

  // Form states
  newFolderName: string
  renamedFolderName: string
  folderError: string | null
  folderLoading: boolean

  // Modal open handlers
  openCreateFolderModal: (parentPath?: string) => void
  openRenameFolderModal: (folderPath: string, currentName: string) => void
  openDeleteFolderModal: (folderPath: string, folderName: string) => Promise<void>

  // Modal close handlers
  closeCreateFolderModal: () => void
  closeRenameFolderModal: () => void
  closeDeleteFolderModal: () => void

  // Form handlers
  setNewFolderName: (name: string) => void
  setRenamedFolderName: (name: string) => void

  // Action handlers
  handleCreateFolder: () => Promise<void>
  handleRenameFolder: () => Promise<void>
  handleDeleteFolder: () => Promise<void>
}

/**
 * Hook for managing folder CRUD operations and modal state.
 */
// eslint-disable-next-line max-lines-per-function -- Folder operations with modals and error handling for CRUD
export function useFolderOperations({
  onOperationComplete,
}: UseFolderOperationsParams): UseFolderOperationsReturn {
  // Modal states
  const [createFolderModal, setCreateFolderModal] = useState<CreateFolderModalState>({
    open: false,
  })
  const [renameFolderModal, setRenameFolderModal] = useState<RenameFolderModalState>({
    open: false,
  })
  const [deleteFolderModal, setDeleteFolderModal] = useState<DeleteFolderModalState>({
    open: false,
  })

  // Form states
  const [newFolderName, setNewFolderName] = useState('')
  const [renamedFolderName, setRenamedFolderName] = useState('')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [folderLoading, setFolderLoading] = useState(false)

  // Modal open handlers
  const openCreateFolderModal = useCallback((parentPath?: string) => {
    setCreateFolderModal({ open: true, parentPath })
    setNewFolderName('')
    setFolderError(null)
    setFolderLoading(false)
  }, [])

  const openRenameFolderModal = useCallback((folderPath: string, currentName: string) => {
    setRenameFolderModal({ open: true, folderPath, currentName })
    setRenamedFolderName(currentName)
    setFolderError(null)
    setFolderLoading(false)
  }, [])

  const openDeleteFolderModal = useCallback(async (folderPath: string, folderName: string) => {
    setFolderError(null)
    setFolderLoading(true)

    try {
      // Count videos in this folder (display_path starts with folderPath)
      const { count, error } = await supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .like('display_path', `${folderPath}/%`)
        .is('deleted_at', null)

      if (error) {
        console.error('Failed to count videos in folder:', error)
        setFolderError(error.message ?? 'Failed to check folder')
        setFolderLoading(false)
        return
      }

      // Show modal with video count
      setDeleteFolderModal({
        open: true,
        folderPath,
        folderName,
        videoCount: count ?? 0,
      })
      setFolderLoading(false)
    } catch (error) {
      console.error('Check folder error:', error)
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }, [])

  // Modal close handlers
  const closeCreateFolderModal = useCallback(() => {
    setCreateFolderModal({ open: false })
  }, [])

  const closeRenameFolderModal = useCallback(() => {
    setRenameFolderModal({ open: false })
  }, [])

  const closeDeleteFolderModal = useCallback(() => {
    setDeleteFolderModal({ open: false })
  }, [])

  // Action handlers
  const handleCreateFolder = useCallback(async () => {
    setFolderError(null)
    setFolderLoading(true)

    try {
      const folderPath = createFolderModal.parentPath
        ? `${createFolderModal.parentPath}/${newFolderName}`
        : newFolderName

      // Note: In this design, folders don't exist independently - they're derived from video paths
      // Creating a folder is just a client-side operation that will be persisted when videos are added
      // For now, we'll just validate the folder name and close the modal

      if (!newFolderName.trim()) {
        setFolderError('Folder name cannot be empty')
        setFolderLoading(false)
        return
      }

      if (newFolderName.includes('/')) {
        setFolderError('Folder name cannot contain "/"')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setCreateFolderModal({ open: false })
      setNewFolderName('')
      onOperationComplete()
    } catch (error) {
      console.error('Create folder error:', error)
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }, [createFolderModal.parentPath, newFolderName, onOperationComplete])

  const handleRenameFolder = useCallback(async () => {
    if (!renameFolderModal.folderPath) return

    setFolderError(null)
    setFolderLoading(true)

    try {
      const oldPath = renameFolderModal.folderPath
      const pathParts = oldPath.split('/')
      pathParts[pathParts.length - 1] = renamedFolderName
      const newPath = pathParts.join('/')

      // Get all videos in this folder
      const { data: videos, error: fetchError } = await supabase
        .from('videos')
        .select('id, display_path')
        .like('display_path', `${oldPath}/%`)
        .is('deleted_at', null)

      if (fetchError) {
        console.error('Failed to fetch videos in folder:', fetchError)
        setFolderError(fetchError.message ?? 'Failed to rename folder')
        setFolderLoading(false)
        return
      }

      // Update each video's display_path (video_path stays as original, storage_key never changes)
      for (const video of videos ?? []) {
        const updatedDisplayPath =
          video.display_path?.replace(oldPath, newPath) ?? video.display_path

        const { error: updateError } = await supabase
          .from('videos')
          .update({
            display_path: updatedDisplayPath,
          })
          .eq('id', video.id)

        if (updateError) {
          console.error('Failed to update video:', updateError)
          setFolderError(updateError.message ?? 'Failed to rename folder')
          setFolderLoading(false)
          return
        }
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setRenameFolderModal({ open: false })
      setRenamedFolderName('')
      onOperationComplete()
    } catch (error) {
      console.error('Rename folder error:', error)
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }, [renameFolderModal.folderPath, renamedFolderName, onOperationComplete])

  const handleDeleteFolder = useCallback(async () => {
    if (!deleteFolderModal.folderPath) return

    setFolderError(null)
    setFolderLoading(true)

    try {
      const folderPath = deleteFolderModal.folderPath

      // Soft delete all videos in this folder by setting deleted_at timestamp
      const { error } = await supabase
        .from('videos')
        .update({
          deleted_at: new Date().toISOString(),
        })
        .like('display_path', `${folderPath}/%`)
        .is('deleted_at', null)

      if (error) {
        console.error('Failed to delete folder:', error)
        setFolderError(error.message ?? 'Failed to delete folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setDeleteFolderModal({ open: false })
      onOperationComplete()
    } catch (error) {
      console.error('Delete folder error:', error)
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }, [deleteFolderModal.folderPath, onOperationComplete])

  return {
    // Modal states
    createFolderModal,
    renameFolderModal,
    deleteFolderModal,

    // Form states
    newFolderName,
    renamedFolderName,
    folderError,
    folderLoading,

    // Modal open handlers
    openCreateFolderModal,
    openRenameFolderModal,
    openDeleteFolderModal,

    // Modal close handlers
    closeCreateFolderModal,
    closeRenameFolderModal,
    closeDeleteFolderModal,

    // Form handlers
    setNewFolderName,
    setRenamedFolderName,

    // Action handlers
    handleCreateFolder,
    handleRenameFolder,
    handleDeleteFolder,
  }
}
