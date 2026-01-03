/**
 * Hook for managing move operations for both videos and folders.
 * Handles the move modal state and move API calls.
 */

import { useState, useCallback, useMemo } from 'react'

import type { MoveModalState, FolderItem } from '~/types/videos'
import type { TreeNode } from '~/utils/video-tree'

interface UseMoveOperationParams {
  /** The video tree structure (for collecting available folders) */
  tree: TreeNode[]
  /** Callback when a move operation completes successfully */
  onMoveComplete: () => void
  /** Callback to clear stats for a moved video */
  clearVideoStats?: (videoId: string) => void
}

interface UseMoveOperationReturn {
  // Modal state
  moveModal: MoveModalState

  // Form states
  selectedTargetFolder: string
  moveError: string | null
  moveLoading: boolean

  // All folders for the folder picker
  allFolders: FolderItem[]

  // Modal open handlers
  openMoveVideoModal: (videoPath: string, videoName: string) => void
  openMoveFolderModal: (folderPath: string, folderName: string) => void

  // Modal close handler
  closeMoveModal: () => void

  // Form handler
  setSelectedTargetFolder: (folder: string) => void

  // Action handler
  handleMove: () => Promise<void>
}

/**
 * Hook for managing move operations for videos and folders.
 */
export function useMoveOperation({
  tree,
  onMoveComplete,
  clearVideoStats,
}: UseMoveOperationParams): UseMoveOperationReturn {
  // Modal state
  const [moveModal, setMoveModal] = useState<MoveModalState>({ open: false })

  // Form states
  const [selectedTargetFolder, setSelectedTargetFolder] = useState('')
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moveLoading, setMoveLoading] = useState(false)

  // Collect all folders from tree for folder picker
  const allFolders = useMemo(() => {
    const folders: FolderItem[] = []

    const collectFolders = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          folders.push({ path: node.path, name: node.path })
          collectFolders(node.children)
        }
      }
    }

    collectFolders(tree)
    return folders
  }, [tree])

  // Modal open handlers
  const openMoveVideoModal = useCallback((videoPath: string, videoName: string) => {
    setMoveModal({
      open: true,
      itemPath: videoPath,
      itemName: videoName,
      itemType: 'video',
    })
    setSelectedTargetFolder('')
    setMoveError(null)
    setMoveLoading(false)
  }, [])

  const openMoveFolderModal = useCallback((folderPath: string, folderName: string) => {
    setMoveModal({
      open: true,
      itemPath: folderPath,
      itemName: folderName,
      itemType: 'folder',
    })
    setSelectedTargetFolder('')
    setMoveError(null)
    setMoveLoading(false)
  }, [])

  // Modal close handler
  const closeMoveModal = useCallback(() => {
    setMoveModal({ open: false })
  }, [])

  // Action handler
  const handleMove = useCallback(async () => {
    setMoveError(null)
    setMoveLoading(true)

    try {
      const { itemPath, itemType } = moveModal

      if (!itemPath || !itemType) {
        setMoveError('Invalid move operation')
        setMoveLoading(false)
        return
      }

      const endpoint = itemType === 'video' ? '/api/videos/move' : '/api/folders/move'
      const bodyKey = itemType === 'video' ? 'videoPath' : 'folderPath'

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [bodyKey]: itemPath,
          targetFolder: selectedTargetFolder,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setMoveError(data.error ?? `Failed to move ${itemType}`)
        setMoveLoading(false)
        return
      }

      // Success - close modal and reload
      setMoveLoading(false)
      setMoveModal({ open: false })
      setSelectedTargetFolder('')

      // Clear cached stats for the moved video (old and new paths)
      if (itemType === 'video' && clearVideoStats) {
        clearVideoStats(itemPath) // Clear old path
        if (data.newPath) {
          clearVideoStats(data.newPath) // Clear new path to force refresh
        }
      }

      onMoveComplete()
    } catch {
      setMoveError('Network error')
      setMoveLoading(false)
    }
  }, [moveModal, selectedTargetFolder, onMoveComplete, clearVideoStats])

  return {
    // Modal state
    moveModal,

    // Form states
    selectedTargetFolder,
    moveError,
    moveLoading,

    // All folders for the folder picker
    allFolders,

    // Modal open handlers
    openMoveVideoModal,
    openMoveFolderModal,

    // Modal close handler
    closeMoveModal,

    // Form handler
    setSelectedTargetFolder,

    // Action handler
    handleMove,
  }
}
