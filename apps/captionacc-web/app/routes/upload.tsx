/**
 * Upload Page - Video file upload workflow with drag-and-drop support (V3)
 *
 * This page allows users to:
 * - Drag and drop folders or individual video files
 * - Preview and configure folder structure before upload
 * - Select a target folder for uploads
 * - Monitor upload progress with TUS resumable uploads
 * - Resolve duplicate videos
 * - View upload history for current session
 *
 * Architecture:
 * - Uses upload-store (sessionStorage persistence, survives navigation)
 * - Preview modal for folder structure configuration
 * - Three sections: Active Uploads, Pending Duplicates, Upload History
 * - Zero polling - pure Zustand subscriptions
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useLoaderData, type LoaderFunctionArgs } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { UploadActiveSection } from '~/components/upload/UploadActiveSection'
import { UploadDropZone } from '~/components/upload/UploadDropZone'
import { UploadDuplicatesSection } from '~/components/upload/UploadDuplicatesSection'
import { UploadHistorySection } from '~/components/upload/UploadHistorySection'
import { UploadPreviewModal } from '~/components/upload/UploadPreviewModal'
import { useUploadFolders } from '~/hooks/useUploadFolders'
import { uploadManager } from '~/services/upload-manager'
import { useUploadStore } from '~/stores/upload-store'
import {
  type UploadFile,
  type UploadOptions,
  processUploadFiles,
} from '~/utils/upload-folder-structure'

// ============================================================================
// Loader
// ============================================================================

export async function clientLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const preselectedFolder = url.searchParams.get('folder')

  // Check authentication
  const { supabase } = await import('~/services/supabase-client')
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    // Redirect to login page
    const { redirect } = await import('react-router')
    const loginUrl = `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`
    throw redirect(loginUrl)
  }

  return new Response(JSON.stringify({ preselectedFolder }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// Component
// ============================================================================

// Large upload page component with comprehensive state management - acceptable length for upload workflow
/* eslint-disable max-lines-per-function */
export default function UploadPage() {
  const loaderData = useLoaderData() as { preselectedFolder: string | null }
  const [isDragActive, setIsDragActive] = useState(false)

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<UploadFile[]>([])
  const [isProcessingDrop, setIsProcessingDrop] = useState(false)
  const [processingStatus, setProcessingStatus] = useState('')

  // Load available folders and videos for the modal
  const { availableFolders, videos } = useUploadFolders(loaderData.preselectedFolder)

  // Upload store state - subscribe to the objects, convert to arrays with useMemo
  const activeUploadsObj = useUploadStore(state => state.activeUploads)
  const pendingDuplicatesObj = useUploadStore(state => state.pendingDuplicates)
  const completedUploads = useUploadStore(state => state.completedUploads)

  // Convert objects to arrays with useMemo to prevent infinite loops
  const activeUploads = useMemo(() => Object.values(activeUploadsObj), [activeUploadsObj])
  const pendingDuplicates = useMemo(
    () => Object.values(pendingDuplicatesObj),
    [pendingDuplicatesObj]
  )

  // Store actions
  const visitedUploadPage = useUploadStore(state => state.visitedUploadPage)
  const abortAll = useUploadStore(state => state.abortAll)
  const cancelQueued = useUploadStore(state => state.cancelQueued)
  const clearHistory = useUploadStore(state => state.clearHistory)
  const resolveDuplicate = useUploadStore(state => state.resolveDuplicate)

  // Individual upload actions
  const handleCancelUpload = useCallback(async (uploadId: string) => {
    console.log(`[UploadPage] Canceling upload ${uploadId}`)
    await uploadManager.cancelUpload(uploadId)
  }, [])

  const handleRetryUpload = useCallback(async (uploadId: string) => {
    console.log(`[UploadPage] Retrying upload ${uploadId}`)
    await uploadManager.retryUpload(uploadId)
  }, [])

  // On mount: mark that user visited upload page (hides notification badge)
  useEffect(() => {
    visitedUploadPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run only once on mount to mark page as visited; visitedUploadPage is stable
  }, [])

  // Helper to check if file is a supported video format
  const isVideoFile = useCallback((file: File): boolean => {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv']
    const fileName = file.name.toLowerCase()
    return videoExtensions.some(ext => fileName.endsWith(ext))
  }, [])

  // Helper to recursively collect files from directory entries
  const collectFilesFromEntry = useCallback(
    async (entry: FileSystemEntry, path = ''): Promise<UploadFile[]> => {
      const results: UploadFile[] = []

      try {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry
          console.log(`[collectFiles] Processing file: ${entry.name}, path: ${path}`)
          const file = await new Promise<File>((resolve, reject) => {
            fileEntry.file(resolve, reject)
          })

          console.log(
            `[collectFiles] Got file: ${file.name}, type: ${file.type}, size: ${file.size}`
          )

          // Only include video files
          if (isVideoFile(file)) {
            console.log(`[collectFiles] ✓ Video file accepted: ${file.name}`)
            results.push({ file, relativePath: path + file.name })
          } else {
            console.log(`[collectFiles] ✗ File rejected (not a video): ${file.name}`)
          }
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry
          console.log(`[collectFiles] Processing directory: ${entry.name}, path: ${path}`)
          const reader = dirEntry.createReader()
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject)
          })

          console.log(`[collectFiles] Directory ${entry.name} has ${entries.length} entries`)

          for (const childEntry of entries) {
            const childPath = path + entry.name + '/'
            const childResults = await collectFilesFromEntry(childEntry, childPath)
            results.push(...childResults)
          }
        }
      } catch (error) {
        console.error(`[collectFiles] Error processing entry ${entry.name}:`, error)
      }

      return results
    },
    [isVideoFile]
  )

  // Collect files and show preview modal
  const showUploadPreview = useCallback((files: UploadFile[]) => {
    if (files.length === 0) {
      console.log('[UploadPage] No video files found to upload')
      return
    }

    console.log(`[UploadPage] Showing preview for ${files.length} video files`)
    setPendingFiles(files)
    setShowPreviewModal(true)
  }, [])

  // Handle modal confirmation - process and upload files
  const handleUploadConfirm = useCallback(
    async (files: UploadFile[], options: UploadOptions) => {
      setShowPreviewModal(false)

      console.log(`[UploadPage] Processing ${files.length} files with options:`, options)

      // Process files according to options
      const processed = processUploadFiles(files, options, videos)

      console.log(`[UploadPage] Starting upload for ${processed.length} processed files`)

      // Start each upload
      for (const upload of processed) {
        try {
          await uploadManager.startUpload(upload.file, {
            fileName: upload.fileName,
            fileType: upload.file.type,
            targetFolder: null, // Already included in finalPath
            relativePath: upload.finalPath,
          })
        } catch (error) {
          console.error(`[UploadPage] Failed to start upload for ${upload.finalPath}:`, error)
        }
      }
    },
    [videos]
  )

  // Handle modal cancellation
  const handleUploadCancel = useCallback(() => {
    setShowPreviewModal(false)
    setPendingFiles([])
  }, [])

  // Drag-and-drop handlers with proper event handling
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Only deactivate if we're leaving the drop zone container itself
    // Check if the relatedTarget (where we're going) is outside the currentTarget
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragActive(false)
      setIsProcessingDrop(true)
      setProcessingStatus('Scanning files...')

      try {
        const items = Array.from(e.dataTransfer.items)
        console.log(`[UploadPage] Processing drop with ${items.length} items`)
        const allFiles: UploadFile[] = []

        // Process each dropped item (could be files or directories)
        for (const item of items) {
          console.log(`[UploadPage] Processing item: ${item.kind}, type: ${item.type}`)
          const entry = item.webkitGetAsEntry()
          if (entry) {
            console.log(
              `[UploadPage] Got entry: ${entry.name}, isFile: ${entry.isFile}, isDirectory: ${entry.isDirectory}`
            )
            setProcessingStatus(`Scanning ${entry.name}...`)
            const files = await collectFilesFromEntry(entry)
            console.log(`[UploadPage] Collected ${files.length} files from ${entry.name}`)
            allFiles.push(...files)
            setProcessingStatus(`Found ${allFiles.length} video files...`)
          } else {
            console.warn(`[UploadPage] No entry for item:`, item)
          }
        }

        console.log(`[UploadPage] Total collected ${allFiles.length} files from drop`)

        if (allFiles.length === 0) {
          console.warn('[UploadPage] No video files found in drop')
        }

        setProcessingStatus('Preparing preview...')

        // Small delay to show final status
        await new Promise(resolve => setTimeout(resolve, 100))

        // Show preview modal
        showUploadPreview(allFiles)
      } catch (error) {
        console.error('[UploadPage] Error processing drop:', error)
      } finally {
        setIsProcessingDrop(false)
        setProcessingStatus('')
      }
    },
    [collectFilesFromEntry, showUploadPreview]
  )

  // Show loading before file input opens
  const handleFileInputClick = useCallback(() => {
    setIsProcessingDrop(true)
    setProcessingStatus('Opening file browser...')
  }, [])

  // Hide loading if user cancels (input loses focus without selecting files)
  const handleFileInputCancel = useCallback(() => {
    setIsProcessingDrop(false)
    setProcessingStatus('')
  }, [])

  // File input handler
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files

      // If no files selected (user canceled), hide loading
      if (!fileList || fileList.length === 0) {
        setIsProcessingDrop(false)
        setProcessingStatus('')
        return
      }

      // Update status - still showing loading from button click
      setProcessingStatus('Loading file list...')

      try {
        // Convert FileList to UploadFile array
        const files = Array.from(fileList)
          .filter(file => isVideoFile(file))
          .map(file => {
            const webkitFile = file as File & { webkitRelativePath?: string }
            return {
              file,
              relativePath: webkitFile.webkitRelativePath || file.name,
            }
          })

        setProcessingStatus(`Found ${files.length} video files...`)

        // Small delay to show status
        await new Promise(resolve => setTimeout(resolve, 100))

        // Show preview modal
        showUploadPreview(files)
      } finally {
        setIsProcessingDrop(false)
        setProcessingStatus('')

        // Reset input so same file can be selected again
        e.target.value = ''
      }
    },
    [isVideoFile, showUploadPreview]
  )

  // Duplicate resolution handler
  const handleResolveDuplicate = useCallback(
    async (uploadId: string, decision: 'keep_both' | 'replace_existing' | 'cancel_upload') => {
      const duplicate = pendingDuplicates.find(d => d.id === uploadId)
      if (!duplicate) {
        console.error('[UploadPage] Could not find duplicate for resolution:', uploadId)
        return
      }

      // For cancel_upload, always remove from UI even if backend call fails
      if (decision === 'cancel_upload') {
        console.log(`[UploadPage] Canceling upload for ${duplicate.relativePath}`)

        // TODO: Integrate duplicate resolution with backend API
        // No endpoint documented in api-endpoints.md for duplicate resolution
        // For now, just remove from UI
        console.log(
          `[UploadPage] Canceling upload for ${duplicate.relativePath} (backend integration pending)`
        )

        // Remove from UI
        resolveDuplicate(uploadId)
        return
      }

      // For keep_both and replace_existing, call backend
      // TODO: Integrate duplicate resolution with backend API
      // No endpoint documented in api-endpoints.md for duplicate resolution
      // For now, just show an error since we can't actually resolve duplicates yet
      console.log(`[UploadPage] Duplicate resolution not yet implemented: ${decision}`)

      const action = decision === 'keep_both' ? 'Keep Both' : 'Replace Existing'
      alert(
        `Duplicate resolution not yet implemented.\n\n` +
          `The backend API doesn't have an endpoint for duplicate resolution yet.\n\n` +
          `You can:\n` +
          `• Click "Cancel Upload" to remove it from the list\n` +
          `• Wait for backend API integration`
      )
    },
    [pendingDuplicates, resolveDuplicate]
  )

  // Derived state
  const hasActiveOperations = activeUploads.length > 0 || pendingDuplicates.length > 0
  const hasHistory = completedUploads.length > 0
  const showDropZone = !hasActiveOperations // Show drop zone when no active uploads/duplicates

  return (
    <AppLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-200">
              Upload Videos
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Upload video files for caption annotation. Drag folders to preserve directory
              structure.
            </p>
          </div>
        </div>

        {/* Drop Zone (shown when no active operations) */}
        {showDropZone && (
          <div className="mt-8">
            <UploadDropZone
              dragActive={isDragActive}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={e => void handleDrop(e)}
              onFileSelect={e => void handleFileSelect(e)}
              onFileInputClick={handleFileInputClick}
              onFileInputCancel={handleFileInputCancel}
            />
          </div>
        )}

        {/* Upload Sections */}
        {(hasActiveOperations || hasHistory) && (
          <>
            {/* Active Uploads */}
            <UploadActiveSection
              uploads={activeUploads}
              onCancelQueued={cancelQueued}
              onAbortAll={abortAll}
              onCancelUpload={id => void handleCancelUpload(id)}
              onRetryUpload={id => void handleRetryUpload(id)}
            />

            {/* Pending Duplicates */}
            <UploadDuplicatesSection
              duplicates={pendingDuplicates}
              onResolveDuplicate={handleResolveDuplicate}
            />

            {/* Upload History */}
            <UploadHistorySection uploads={completedUploads} onClearHistory={clearHistory} />
          </>
        )}
      </div>

      {/* Processing Overlay */}
      {isProcessingDrop && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl px-8 py-6 flex flex-col items-center gap-4">
            {/* Spinner */}
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
            {/* Status Text */}
            <div className="text-center">
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Processing Files
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{processingStatus}</p>
            </div>
          </div>
        </div>
      )}

      {/* Upload Preview Modal */}
      {showPreviewModal && (
        <UploadPreviewModal
          files={pendingFiles}
          availableFolders={availableFolders}
          videos={videos}
          defaultTargetFolder={loaderData.preselectedFolder}
          onConfirm={(files, options) => void handleUploadConfirm(files, options)}
          onCancel={handleUploadCancel}
        />
      )}
    </AppLayout>
  )
}
