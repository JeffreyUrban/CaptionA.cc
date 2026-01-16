/**
 * Hook for managing drag and drop operations.
 * Handles drag state, validation, and drop operations for videos and folders.
 */

import { useState, useCallback } from 'react'

import { supabase } from '~/services/supabase-client'
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
 * Helper function to perform move operations using Supabase
 */
async function performMoveOperation(
  itemPath: string,
  itemType: 'video' | 'folder',
  targetFolder: string
): Promise<{ success: boolean; newPath?: string; error?: string }> {
  try {
    if (itemType === 'video') {
      // Move a single video (only update display_path, video_path stays as original)
      const pathParts = itemPath.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName

      const { error } = await supabase
        .from('videos')
        .update({
          display_path: newPath,
        })
        .eq('display_path', itemPath)
        .is('deleted_at', null)

      if (error) {
        console.error('Failed to move video:', error)
        return { success: false, error: error.message }
      }

      return { success: true, newPath }
    } else {
      // Move a folder (update all videos in the folder)
      const { data: videos, error: fetchError } = await supabase
        .from('videos')
        .select('id, display_path')
        .like('display_path', `${itemPath}/%`)
        .is('deleted_at', null)

      if (fetchError) {
        console.error('Failed to fetch videos in folder:', fetchError)
        return { success: false, error: fetchError.message }
      }

      // Update each video's display_path (video_path stays as original, storage_key never changes)
      for (const video of videos ?? []) {
        const relativePath = video.display_path?.replace(`${itemPath}/`, '') ?? ''
        const newDisplayPath = targetFolder
          ? `${targetFolder}/${itemPath.split('/').pop()}/${relativePath}`
          : `${itemPath.split('/').pop()}/${relativePath}`

        const { error: updateError } = await supabase
          .from('videos')
          .update({
            display_path: newDisplayPath,
          })
          .eq('id', video.id)

        if (updateError) {
          console.error('Failed to update video:', updateError)
          return { success: false, error: updateError.message }
        }
      }

      return { success: true }
    }
  } catch (error) {
    console.error('Move operation error:', error)
    return { success: false, error: 'Network error' }
  }
}

/**
 * Hook for managing drag and drop operations for videos and folders.
 */
// eslint-disable-next-line max-lines-per-function -- Drag and drop logic with multiple event handlers and validation
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
        const result = await performMoveOperation(draggedItem.path, draggedItem.type, '')

        if (!result.success) {
          const errorMessage = result.error ?? `Failed to move ${draggedItem.type}`
          console.error(`[DnD] Failed to move ${draggedItem.type} to root:`, errorMessage)
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
          if (result.newPath) {
            clearVideoStats(result.newPath) // Clear new path to force refresh
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
    // eslint-disable-next-line complexity -- Drop handler validates multiple conditions and handles different item types
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
        const result = await performMoveOperation(
          draggedItem.path,
          draggedItem.type,
          targetFolderPath
        )

        if (!result.success) {
          const errorMessage = result.error ?? `Failed to move ${draggedItem.type}`
          console.error(`[DnD] Failed to move ${draggedItem.type}:`, errorMessage)
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
          if (result.newPath) {
            clearVideoStats(result.newPath) // Clear new path to force refresh
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
