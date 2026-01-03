/**
 * Hook for managing drag and drop operations.
 * Handles drag state, validation, and drop operations for videos and folders.
 */

import { useState, useCallback } from 'react'

import type { DraggedItemState } from '~/types/videos'

interface UseVideoDragDropParams {
  /** Callback when a drop operation completes successfully */
  onMoveComplete: () => void
  /** Callback to clear stats for a moved video */
  clearVideoStats?: (videoId: string) => void
}

interface UseVideoDragDropReturn {
  /** Currently dragged item state */
  draggedItem: DraggedItemState | null
  /** Currently hovered folder path during drag */
  dragOverFolder: string | null
  /** Drag-drop error modal state */
  dragDropErrorModal: { open: boolean; title: string; message: string }
  /** Close drag-drop error modal */
  closeDragDropErrorModal: () => void
  /** Start dragging an item */
  handleDragStart: (path: string, name: string, type: 'video' | 'folder') => void
  /** End drag operation */
  handleDragEnd: () => void
  /** Handle drag over a folder */
  handleDragOver: (e: React.DragEvent, folderPath: string) => void
  /** Handle drag leave a folder */
  handleDragLeave: (e: React.DragEvent) => void
  /** Handle drag over the root drop zone */
  handleRootDragOver: (e: React.DragEvent) => void
  /** Handle drag leave the root drop zone */
  handleRootDragLeave: (e: React.DragEvent) => void
  /** Handle drop on the root */
  handleRootDrop: (e: React.DragEvent) => Promise<void>
  /** Handle drop on a folder */
  handleDrop: (e: React.DragEvent, targetFolderPath: string) => Promise<void>
}

/**
 * Hook for managing drag and drop operations for videos and folders.
 */
export function useVideoDragDrop({
  onMoveComplete,
  clearVideoStats,
}: UseVideoDragDropParams): UseVideoDragDropReturn {
  const [draggedItem, setDraggedItem] = useState<DraggedItemState | null>(null)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [dragDropErrorModal, setDragDropErrorModal] = useState({
    open: false,
    title: '',
    message: '',
  })

  const closeDragDropErrorModal = useCallback(() => {
    setDragDropErrorModal({ open: false, title: '', message: '' })
  }, [])

  const handleDragStart = useCallback((path: string, name: string, type: 'video' | 'folder') => {
    console.log('[DnD] Drag start:', { path, name, type })
    setDraggedItem({ path, name, type })
  }, [])

  const handleDragEnd = useCallback(() => {
    console.log('[DnD] Drag end')
    setDraggedItem(null)
    setDragOverFolder(null)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, folderPath: string) => {
      e.preventDefault()
      e.stopPropagation()

      // Don't allow dropping on itself or its descendants
      if (draggedItem) {
        if (draggedItem.type === 'folder') {
          // Can't drop folder on itself or its descendants
          if (folderPath === draggedItem.path || folderPath.startsWith(`${draggedItem.path}/`)) {
            console.log('[DnD] Drag over BLOCKED: cannot drop folder on itself or descendant')
            return
          }
        }

        // Can't drop item on its current parent
        const itemPathParts = draggedItem.path.split('/')
        const currentParent = itemPathParts.length > 1 ? itemPathParts.slice(0, -1).join('/') : ''
        if (folderPath === currentParent) {
          console.log('[DnD] Drag over BLOCKED: already in this folder')
          return
        }

        setDragOverFolder(folderPath)
      }
    },
    [draggedItem]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
  }, [])

  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (draggedItem) {
        // Check if item is already at root
        const itemPathParts = draggedItem.path.split('/')
        const currentParent = itemPathParts.length > 1 ? itemPathParts.slice(0, -1).join('/') : ''

        if (currentParent === '') {
          // Already at root, don't highlight
          setDragOverFolder(null)
          return
        }

        // Set special marker for root drop zone
        setDragOverFolder('__ROOT__')
      }
    },
    [draggedItem]
  )

  const handleRootDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (dragOverFolder === '__ROOT__') {
        setDragOverFolder(null)
      }
    },
    [dragOverFolder]
  )

  const handleRootDrop = useCallback(
    async (e: React.DragEvent) => {
      console.log('[DnD] Root drop triggered')
      e.preventDefault()
      e.stopPropagation()
      setDragOverFolder(null)

      if (!draggedItem) {
        console.log('[DnD] Root drop cancelled: no dragged item')
        return
      }

      // Check if already at root
      const itemPathParts = draggedItem.path.split('/')
      const currentParent = itemPathParts.length > 1 ? itemPathParts.slice(0, -1).join('/') : ''

      if (currentParent === '') {
        console.log('[DnD] Root drop cancelled: already at root')
        return
      }

      // Perform the move to root (empty string as target folder)
      console.log('[DnD] Performing move to root...')
      try {
        const endpoint = draggedItem.type === 'video' ? '/api/videos/move' : '/api/folders/move'
        const bodyKey = draggedItem.type === 'video' ? 'videoPath' : 'folderPath'

        console.log('[DnD] API call:', { endpoint, [bodyKey]: draggedItem.path, targetFolder: '' })

        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [bodyKey]: draggedItem.path,
            targetFolder: '', // Empty string = root
          }),
        })

        const data = await response.json()
        console.log('[DnD] API response:', { ok: response.ok, status: response.status, data })

        if (!response.ok) {
          const errorMessage = data.error ?? `Failed to move ${draggedItem.type}`
          // Use warn for validation errors (4xx), error for server/network issues (5xx)
          if (response.status >= 400 && response.status < 500) {
            console.warn(`[DnD] Move blocked:`, errorMessage)
          } else {
            console.error(`[DnD] Failed to move ${draggedItem.type} to root:`, errorMessage)
          }
          setDragDropErrorModal({
            open: true,
            title: 'Move Failed',
            message: errorMessage,
          })
          return
        }

        console.log('[DnD] Move to root successful, reloading tree...')

        // Clear cached stats for moved video (old and new paths)
        if (draggedItem.type === 'video' && clearVideoStats) {
          clearVideoStats(draggedItem.path) // Clear old path
          if (data.newPath) {
            clearVideoStats(data.newPath) // Clear new path to force refresh
          }
        }

        // Success - notify parent to reload
        onMoveComplete()
      } catch (error) {
        console.error('Network error during root drop:', error)
      } finally {
        setDraggedItem(null)
      }
    },
    [draggedItem, onMoveComplete, clearVideoStats]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetFolderPath: string) => {
      console.log('[DnD] Drop triggered:', { targetFolderPath, draggedItem })
      e.preventDefault()
      e.stopPropagation()
      setDragOverFolder(null)

      if (!draggedItem) {
        console.log('[DnD] Drop cancelled: no dragged item')
        return
      }

      // Don't allow dropping on itself or its descendants
      if (draggedItem.type === 'folder') {
        if (
          targetFolderPath === draggedItem.path ||
          targetFolderPath.startsWith(`${draggedItem.path}/`)
        ) {
          console.log('[DnD] Drop cancelled: cannot drop folder on itself or descendant')
          return
        }
      }

      // Don't allow dropping on current parent
      const itemPathParts = draggedItem.path.split('/')
      const currentParent = itemPathParts.length > 1 ? itemPathParts.slice(0, -1).join('/') : ''
      if (targetFolderPath === currentParent) {
        console.log('[DnD] Drop cancelled: already in this folder')
        return
      }

      // Perform the move
      console.log('[DnD] Performing move...')
      try {
        const endpoint = draggedItem.type === 'video' ? '/api/videos/move' : '/api/folders/move'
        const bodyKey = draggedItem.type === 'video' ? 'videoPath' : 'folderPath'

        console.log('[DnD] API call:', {
          endpoint,
          [bodyKey]: draggedItem.path,
          targetFolder: targetFolderPath,
        })

        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [bodyKey]: draggedItem.path,
            targetFolder: targetFolderPath,
          }),
        })

        const data = await response.json()
        console.log('[DnD] API response:', { ok: response.ok, status: response.status, data })

        if (!response.ok) {
          const errorMessage = data.error ?? `Failed to move ${draggedItem.type}`
          // Use warn for validation errors (4xx), error for server/network issues (5xx)
          if (response.status >= 400 && response.status < 500) {
            console.warn(`[DnD] Move blocked:`, errorMessage)
          } else {
            console.error(`[DnD] Failed to move ${draggedItem.type}:`, errorMessage)
          }
          setDragDropErrorModal({
            open: true,
            title: 'Move Failed',
            message: errorMessage,
          })
          return
        }

        console.log('[DnD] Move successful, reloading tree...')

        // Clear cached stats for moved video (old and new paths)
        if (draggedItem.type === 'video' && clearVideoStats) {
          clearVideoStats(draggedItem.path) // Clear old path
          if (data.newPath) {
            clearVideoStats(data.newPath) // Clear new path to force refresh
          }
        }

        // Success - notify parent to reload
        onMoveComplete()
      } catch (error) {
        console.error('Network error during drop:', error)
      } finally {
        setDraggedItem(null)
      }
    },
    [draggedItem, onMoveComplete, clearVideoStats]
  )

  return {
    draggedItem,
    dragOverFolder,
    dragDropErrorModal,
    closeDragDropErrorModal,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
    handleDrop,
  }
}
