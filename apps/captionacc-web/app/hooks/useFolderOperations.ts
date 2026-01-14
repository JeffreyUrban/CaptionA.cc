/**
 * Hook for managing folder CRUD operations.
 * Handles create, rename, and delete folder operations along with modal state.
 */

import { useState, useCallback } from 'react'

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
      // First, get the video count
      const response = await fetch(`/api/folders/delete?path=${encodeURIComponent(folderPath)}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (data.requiresConfirmation) {
        // Show modal with video count
        setDeleteFolderModal({
          open: true,
          folderPath,
          folderName,
          videoCount: data.videoCount,
        })
        setFolderLoading(false)
      } else if (!response.ok) {
        setFolderError(data.error ?? 'Failed to check folder')
        setFolderLoading(false)
      }
    } catch {
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

      const response = await fetch('/api/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath }),
      })

      const data = await response.json()

      if (!response.ok) {
        setFolderError(data.error ?? 'Failed to create folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setCreateFolderModal({ open: false })
      setNewFolderName('')
      onOperationComplete()
    } catch {
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

      const response = await fetch('/api/folders/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      })

      const data = await response.json()

      if (!response.ok) {
        setFolderError(data.error ?? 'Failed to rename folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setRenameFolderModal({ open: false })
      setRenamedFolderName('')
      onOperationComplete()
    } catch {
      setFolderError('Network error')
      setFolderLoading(false)
    }
  }, [renameFolderModal.folderPath, renamedFolderName, onOperationComplete])

  const handleDeleteFolder = useCallback(async () => {
    if (!deleteFolderModal.folderPath) return

    setFolderError(null)
    setFolderLoading(true)

    try {
      // Delete with confirmed=true parameter
      const response = await fetch(
        `/api/folders/delete?path=${encodeURIComponent(deleteFolderModal.folderPath)}&confirmed=true`,
        {
          method: 'DELETE',
        }
      )

      const data = await response.json()

      if (!response.ok) {
        setFolderError(data.error ?? 'Failed to delete folder')
        setFolderLoading(false)
        return
      }

      // Success - close modal and reload
      setFolderLoading(false)
      setDeleteFolderModal({ open: false })
      onOperationComplete()
    } catch {
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
