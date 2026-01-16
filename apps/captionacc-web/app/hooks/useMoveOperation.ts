/**
 * Hook for managing move operations for both videos and folders.
 * Handles the move modal state and move API calls.
 */

import { useState, useCallback, useMemo } from 'react'

import { supabase } from '~/services/supabase-client'
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

      if (itemType === 'video') {
        // Move a single video (only update display_path, video_path stays as original)
        const pathParts = itemPath.split('/')
        const fileName = pathParts[pathParts.length - 1]
        const newPath = selectedTargetFolder ? `${selectedTargetFolder}/${fileName}` : fileName

        const { error } = await supabase
          .from('videos')
          .update({
            display_path: newPath,
          })
          .eq('display_path', itemPath)
          .is('deleted_at', null)

        if (error) {
          console.error('Failed to move video:', error)
          setMoveError(error.message ?? 'Failed to move video')
          setMoveLoading(false)
          return
        }

        // Clear cached stats for old and new paths
        if (clearVideoStats) {
          clearVideoStats(itemPath)
          clearVideoStats(newPath)
        }
      } else {
        // Move a folder (update all videos in the folder)
        const { data: videos, error: fetchError } = await supabase
          .from('videos')
          .select('id, display_path')
          .like('display_path', `${itemPath}/%`)
          .is('deleted_at', null)

        if (fetchError) {
          console.error('Failed to fetch videos in folder:', fetchError)
          setMoveError(fetchError.message ?? 'Failed to move folder')
          setMoveLoading(false)
          return
        }

        // Update each video's display_path (video_path stays as original, storage_key never changes)
        for (const video of videos ?? []) {
          const relativePath = video.display_path?.replace(`${itemPath}/`, '') ?? ''
          const newDisplayPath = selectedTargetFolder
            ? `${selectedTargetFolder}/${itemPath.split('/').pop()}/${relativePath}`
            : `${itemPath.split('/').pop()}/${relativePath}`

          const { error: updateError } = await supabase
            .from('videos')
            .update({
              display_path: newDisplayPath,
            })
            .eq('id', video.id)

          if (updateError) {
            console.error('Failed to update video:', updateError)
            setMoveError(updateError.message ?? 'Failed to move folder')
            setMoveLoading(false)
            return
          }
        }
      }

      // Success - close modal and reload
      setMoveLoading(false)
      setMoveModal({ open: false })
      setSelectedTargetFolder('')
      onMoveComplete()
    } catch (error) {
      console.error('Move operation error:', error)
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
