/**
 * Hook for managing folder selection in the upload workflow.
 * Loads available folders and handles preselected folder from URL.
 */

import { useState, useEffect } from 'react'

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

        const response = await fetch('/api/folders')
        const data = await response.json()
        setAvailableFolders(data.folders ?? [])

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
