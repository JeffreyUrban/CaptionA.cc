/**
 * Hook for managing video file state in the upload workflow.
 * Handles file processing, selection, duplicate detection, and folder collapse.
 */

import { useState, useCallback } from 'react'

import type { VideoFilePreview, FileWithPath } from '~/types/upload'
import { collapseSingleVideoFolders } from '~/utils/upload-helpers'

interface UseUploadFilesResult {
  videoFiles: VideoFilePreview[]
  setVideoFiles: React.Dispatch<React.SetStateAction<VideoFilePreview[]>>
  skippedFiles: File[]
  collapseEnabled: boolean
  collapsesAvailable: boolean
  processFiles: (fileList: FileList | null) => Promise<void>
  toggleFileSelection: (index: number) => void
  selectAllFiles: (selected: boolean) => void
  deselectDuplicates: () => void
  handleCollapseToggle: (enabled: boolean) => Promise<void>
  resetFiles: () => void
}

/**
 * Hook for managing video file state, processing, and selection.
 *
 * @param uploading - Whether uploads are currently in progress
 * @returns File state and manipulation functions
 */
export function useUploadFiles(uploading: boolean): UseUploadFilesResult {
  const [videoFiles, setVideoFiles] = useState<VideoFilePreview[]>([])
  const [skippedFiles, setSkippedFiles] = useState<File[]>([])
  const [collapseEnabled, setCollapseEnabled] = useState(true)
  const [collapsesAvailable, setCollapsesAvailable] = useState(false)

  /**
   * Process a FileList and extract video files
   */
  const processFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return

      // Prevent starting new upload while one is in progress
      if (uploading) {
        console.log('[processFiles] Upload already in progress, ignoring new files')
        alert(
          'An upload is already in progress. Please wait for it to complete before starting a new upload.'
        )
        return
      }

      console.log(`[processFiles] Processing ${fileList.length} files`)
      const videos: VideoFilePreview[] = []
      const skipped: File[] = []

      for (const file of Array.from(fileList)) {
        if (file.type.startsWith('video/')) {
          const relativePath = (file as FileWithPath).webkitRelativePath ?? file.name
          console.log(`[processFiles] Found video: ${relativePath} (${file.type})`)
          videos.push({
            file,
            relativePath,
            size: file.size,
            type: file.type,
            selected: true,
            uploadProgress: 0,
            uploadStatus: 'queued',
          })
        } else {
          skipped.push(file)
        }
      }

      console.log(`[processFiles] Result: ${videos.length} videos, ${skipped.length} skipped`)

      // Check if collapses are available (preview mode)
      const collapseCount = await collapseSingleVideoFolders(videos, true)
      setCollapsesAvailable(collapseCount > 0)
      console.log(`[processFiles] ${collapseCount} collapse(s) available`)

      // Apply collapse immediately if available (so preview shows collapsed paths)
      if (collapseCount > 0) {
        await collapseSingleVideoFolders(videos, false)
        console.log('[processFiles] Applied folder collapse to preview')
      }

      // Check for duplicates
      if (videos.length > 0) {
        const videoPaths = videos.map(v => {
          const pathParts = v.relativePath.split('/')
          const filename = pathParts[pathParts.length - 1]
          if (!filename) return ''
          return pathParts
            .slice(0, -1)
            .concat(filename.replace(/\.\w+$/, ''))
            .join('/')
        })

        try {
          console.log('[processFiles] Checking for duplicates:', videoPaths)
          const response = await fetch(
            `/api/annotations/check-duplicates?paths=${encodeURIComponent(videoPaths.join(','))}`
          )
          const duplicates = await response.json()
          console.log('[processFiles] Duplicate check results:', duplicates)

          for (let i = 0; i < videos.length; i++) {
            const videoPath = videoPaths[i]
            if (!videoPath) continue
            const duplicateInfo = duplicates[videoPath]
            if (!duplicateInfo?.exists) continue

            console.log(`[processFiles] Found duplicate: ${videoPath}`)
            const video = videos[i]
            if (!video) continue
            video.isDuplicate = true
            video.existingUploadedAt = duplicateInfo.uploadedAt
          }
        } catch (error) {
          console.error('Failed to check duplicates:', error)
        }
      }

      setVideoFiles(videos)
      setSkippedFiles(skipped)
    },
    [uploading]
  )

  /**
   * Toggle selection for a single file
   */
  const toggleFileSelection = useCallback((index: number) => {
    setVideoFiles(prev => prev.map((f, i) => (i === index ? { ...f, selected: !f.selected } : f)))
  }, [])

  /**
   * Select or deselect all files
   */
  const selectAllFiles = useCallback((selected: boolean) => {
    setVideoFiles(prev => prev.map(f => ({ ...f, selected })))
  }, [])

  /**
   * Deselect all duplicate files
   */
  const deselectDuplicates = useCallback(() => {
    setVideoFiles(prev => prev.map(f => (f.isDuplicate ? { ...f, selected: false } : f)))
  }, [])

  /**
   * Handle collapse toggle - re-apply or restore original paths
   */
  const handleCollapseToggle = useCallback(
    async (enabled: boolean) => {
      setCollapseEnabled(enabled)

      if (enabled && collapsesAvailable) {
        // Re-apply collapse
        console.log('[handleCollapseToggle] Applying collapse...')
        setVideoFiles(prev => {
          void collapseSingleVideoFolders(prev, false)
          return [...prev] // Return new array to trigger re-render
        })
      } else {
        // Restore original paths
        console.log('[handleCollapseToggle] Restoring original paths...')
        setVideoFiles(prev =>
          prev.map(v => ({
            ...v,
            relativePath: (v.file as FileWithPath).webkitRelativePath ?? v.file.name,
          }))
        )
      }
    },
    [collapsesAvailable]
  )

  /**
   * Reset all file state
   */
  const resetFiles = useCallback(() => {
    setVideoFiles([])
    setSkippedFiles([])
    setCollapseEnabled(true)
    setCollapsesAvailable(false)
  }, [])

  return {
    videoFiles,
    setVideoFiles,
    skippedFiles,
    collapseEnabled,
    collapsesAvailable,
    processFiles,
    toggleFileSelection,
    selectAllFiles,
    deselectDuplicates,
    handleCollapseToggle,
    resetFiles,
  }
}
