/**
 * Upload Page - Video file upload workflow with drag-and-drop support (V2)
 *
 * This page allows users to:
 * - Drag and drop folders or individual video files
 * - Select a target folder for uploads
 * - Monitor upload progress with TUS resumable uploads
 * - Resolve duplicate videos
 * - View upload history for current session
 *
 * Architecture:
 * - Uses upload-store (sessionStorage persistence, survives navigation)
 * - Three sections: Active Uploads, Pending Duplicates, Upload History
 * - Zero polling - pure Zustand subscriptions
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useLoaderData, type LoaderFunctionArgs } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { UploadActiveSection } from '~/components/upload/UploadActiveSection'
import { UploadDropZone } from '~/components/upload/UploadDropZone'
import { UploadDuplicatesSection } from '~/components/upload/UploadDuplicatesSection'
import { UploadFolderSelector } from '~/components/upload/UploadFolderSelector'
import { UploadHistorySection } from '~/components/upload/UploadHistorySection'
import { useUploadFolders } from '~/hooks/useUploadFolders'
import { uploadManager } from '~/services/upload-manager'
import { useUploadStore } from '~/stores/upload-store'

// ============================================================================
// Loader
// ============================================================================

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const preselectedFolder = url.searchParams.get('folder')

  return new Response(JSON.stringify({ preselectedFolder }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// Component
// ============================================================================

export default function UploadPage() {
  const loaderData = useLoaderData() as { preselectedFolder: string | null }
  const [isDragActive, setIsDragActive] = useState(false)

  // Folder selector
  const { selectedFolder, setSelectedFolder, availableFolders } = useUploadFolders(
    loaderData.preselectedFolder
  )

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Helper to recursively collect files from directory entries
  const collectFilesFromEntry = useCallback(
    async (entry: FileSystemEntry, path = ''): Promise<Array<{ file: File; path: string }>> => {
      const results: Array<{ file: File; path: string }> = []

      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        const file = await new Promise<File>((resolve, reject) => {
          fileEntry.file(resolve, reject)
        })
        results.push({ file, path: path + file.name })
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry
        const reader = dirEntry.createReader()
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject)
        })

        for (const childEntry of entries) {
          const childPath = path + entry.name + '/'
          const childResults = await collectFilesFromEntry(childEntry, childPath)
          results.push(...childResults)
        }
      }

      return results
    },
    []
  )

  // Process dropped or selected files
  const processFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return

      console.log(`[UploadPage] Processing ${fileList.length} files`)

      // Start each file upload via upload manager
      const files = Array.from(fileList)
      for (const file of files) {
        // Determine relative path from webkitRelativePath or just filename
        const webkitFile = file as File & { webkitRelativePath?: string }
        const relativePath = webkitFile.webkitRelativePath || file.name

        try {
          await uploadManager.startUpload(file, {
            fileName: file.name,
            fileType: file.type,
            targetFolder: selectedFolder,
            relativePath,
          })
        } catch (error) {
          console.error(`[UploadPage] Failed to start upload for ${relativePath}:`, error)
        }
      }
    },
    [selectedFolder]
  )

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragActive(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    // Only deactivate if leaving the drop zone entirely
    if (e.currentTarget === e.target) {
      setIsDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragActive(false)

      const items = Array.from(e.dataTransfer.items)
      const allFiles: Array<{ file: File; path: string }> = []

      // Process each dropped item (could be files or directories)
      for (const item of items) {
        const entry = item.webkitGetAsEntry()
        if (entry) {
          const files = await collectFilesFromEntry(entry)
          allFiles.push(...files)
        }
      }

      console.log(`[UploadPage] Collected ${allFiles.length} files from drop`)

      // Upload each collected file
      for (const { file, path } of allFiles) {
        try {
          await uploadManager.startUpload(file, {
            fileName: file.name,
            fileType: file.type,
            targetFolder: selectedFolder,
            relativePath: path,
          })
        } catch (error) {
          console.error(`[UploadPage] Failed to start upload for ${path}:`, error)
        }
      }
    },
    [collectFilesFromEntry, selectedFolder]
  )

  // File input handler
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void processFiles(e.target.files)
      // Reset input so same file can be selected again
      e.target.value = ''
    },
    [processFiles]
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

        // Try to call backend (best effort)
        try {
          const response = await fetch(`/api/uploads/resolve-duplicate/${duplicate.videoId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ decision }),
          })

          if (!response.ok) {
            console.warn('[UploadPage] Backend cancel failed, removing from UI anyway')
          }
        } catch (error) {
          console.warn('[UploadPage] Backend cancel error, removing from UI anyway:', error)
        }

        // Always remove from UI
        resolveDuplicate(uploadId)
        return
      }

      // For keep_both and replace_existing, call backend
      try {
        console.log(`[UploadPage] Resolving duplicate ${duplicate.videoId}: ${decision}`)

        const response = await fetch(`/api/uploads/resolve-duplicate/${duplicate.videoId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ decision }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Server returned ${response.status}: ${errorText}`)
        }

        console.log(`[UploadPage] Resolved duplicate ${duplicate.videoId}: ${decision}`)

        // Remove from pending duplicates
        resolveDuplicate(uploadId)
      } catch (error) {
        console.error('[UploadPage] Error resolving duplicate:', error)
        const action = decision === 'keep_both' ? 'Keep Both' : 'Replace Existing'
        const errorMsg = error instanceof Error ? error.message : String(error)
        alert(
          `Failed to ${action}:\n\n${errorMsg}\n\n` +
            `You can:\n` +
            `• Try again (the duplicate will remain in the list)\n` +
            `• Click "Cancel Upload" to remove it without resolving`
        )
      }
    },
    [pendingDuplicates, resolveDuplicate]
  )

  // Derived state
  const hasAnyUploads =
    activeUploads.length > 0 || pendingDuplicates.length > 0 || completedUploads.length > 0
  const showDropZone = !hasAnyUploads

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

        {/* Drop Zone (shown when no uploads) */}
        {showDropZone && (
          <div className="mt-8">
            <UploadFolderSelector
              selectedFolder={selectedFolder}
              availableFolders={availableFolders}
              onSelect={setSelectedFolder}
            />
            <UploadDropZone
              dragActive={isDragActive}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFileSelect={handleFileSelect}
            />
          </div>
        )}

        {/* Upload Sections */}
        {hasAnyUploads && (
          <>
            {/* Folder Selector (compact version when uploads active) */}
            <div className="mt-6">
              <UploadFolderSelector
                selectedFolder={selectedFolder}
                availableFolders={availableFolders}
                onSelect={setSelectedFolder}
              />
            </div>

            {/* Active Uploads */}
            <UploadActiveSection
              uploads={activeUploads}
              onCancelQueued={cancelQueued}
              onAbortAll={abortAll}
              onCancelUpload={handleCancelUpload}
              onRetryUpload={handleRetryUpload}
            />

            {/* Pending Duplicates */}
            <UploadDuplicatesSection
              duplicates={pendingDuplicates}
              onResolveDuplicate={handleResolveDuplicate}
            />

            {/* Upload History */}
            <UploadHistorySection uploads={completedUploads} onClearHistory={clearHistory} />

            {/* Upload More Button */}
            {activeUploads.length === 0 && pendingDuplicates.length === 0 && (
              <div className="mt-6">
                <label className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700 cursor-pointer">
                  <input
                    type="file"
                    multiple
                    // @ts-expect-error - webkitdirectory is non-standard but widely supported
                    webkitdirectory=""
                    className="sr-only"
                    onChange={handleFileSelect}
                  />
                  Upload More Videos
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
