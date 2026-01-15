/**
 * Hook for managing folder selection in the upload workflow.
 * Loads available folders and handles preselected folder from URL.
 */

import { useState, useEffect } from 'react'

import { supabase } from '~/services/supabase-client'
import type { FolderItem } from '~/types/upload'

interface UseUploadFoldersResult {
  selectedFolder: string
  setSelectedFolder: (folder: string) => void
  availableFolders: FolderItem[]
  loading: boolean
  error: string | null
}

/**
 * Hook for managing folder selection state and loading available folders.
 *
 * @param preselectedFolder - Optional folder path from URL parameters
 * @returns Folder selection state and available folders
 */
export function useUploadFolders(preselectedFolder: string | null): UseUploadFoldersResult {
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [availableFolders, setAvailableFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load folders and handle preselected folder
  useEffect(() => {
    const loadFolders = async () => {
      try {
        setLoading(true)
        setError(null)

        // Query videos to extract folder structure from display_path
        const { data: videos, error: videosError } = await supabase
          .from('videos')
          .select('display_path')
          .is('deleted_at', null)

        if (videosError) throw videosError

        // Extract unique folder paths
        const folderSet = new Set<string>()
        videos?.forEach(video => {
          if (video.display_path) {
            // Extract folder path (everything before the last /)
            const lastSlash = video.display_path.lastIndexOf('/')
            if (lastSlash > 0) {
              const folder = video.display_path.substring(0, lastSlash)
              folderSet.add(folder)

              // Also add parent folders
              const parts = folder.split('/')
              for (let i = 1; i < parts.length; i++) {
                folderSet.add(parts.slice(0, i).join('/'))
              }
            }
          }
        })

        // Convert to FolderItem array
        const folders: FolderItem[] = Array.from(folderSet).map(path => ({
          path,
          name: path.split('/').pop() || path,
        }))

        setAvailableFolders(folders.sort((a, b) => a.path.localeCompare(b.path)))

        // Set preselected folder from URL
        if (preselectedFolder) {
          setSelectedFolder(preselectedFolder)
        }
      } catch (err) {
        console.error('Failed to load folders:', err)
        setError('Failed to load folders')
      } finally {
        setLoading(false)
      }
    }

    void loadFolders()
  }, [preselectedFolder])

  return {
    selectedFolder,
    setSelectedFolder,
    availableFolders,
    loading,
    error,
  }
}
