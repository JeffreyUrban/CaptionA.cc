/**
 * Upload Page - Video file upload workflow with drag-and-drop support.
 *
 * This page allows users to:
 * - Drag and drop folders or individual video files
 * - Select a target folder for uploads
 * - Preview and confirm files before upload
 * - Monitor upload progress with TUS resumable uploads
 * - Handle retries and cancellation
 */

import { useState, useCallback } from 'react'
import { useLoaderData, type LoaderFunctionArgs } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { StopQueuedModal, AbortAllModal } from '~/components/upload/UploadCancelModals'
import { UploadConfirmationModal } from '~/components/upload/UploadConfirmationModal'
import { UploadDropZone } from '~/components/upload/UploadDropZone'
import { UploadFolderSelector } from '~/components/upload/UploadFolderSelector'
import {
  UploadProgressSection,
  IncompleteUploadsNotification,
} from '~/components/upload/UploadProgressSection'
import { useIncompleteUploadsV2 } from '~/hooks/useIncompleteUploadsV2'
import { useUploadDragDrop } from '~/hooks/useUploadDragDrop'
import { useUploadFiles } from '~/hooks/useUploadFiles'
import { useUploadFolders } from '~/hooks/useUploadFolders'
import { useUploadQueueV2 } from '~/hooks/useUploadQueueV2'
import { useAppStore } from '~/stores/app-store'
import { calculateUploadStats } from '~/utils/upload-helpers'

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
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)

  // Hooks for upload workflow
  const { selectedFolder, setSelectedFolder, availableFolders } = useUploadFolders(
    loaderData.preselectedFolder
  )
  const { incompleteUploads, showIncompletePrompt, clearIncompleteUploads } =
    useIncompleteUploadsV2()
  const fileState = useUploadFiles(false)
  const uploadQueue = useUploadQueueV2(
    fileState.videoFiles,
    fileState.setVideoFiles,
    selectedFolder
  )

  // Drag-and-drop with file processing callback
  const handleFilesDropped = useCallback(
    (files: FileList) => {
      void fileState.processFiles(files)
      setShowConfirmation(true)
    },
    [fileState]
  )
  const dragDrop = useUploadDragDrop(handleFilesDropped, uploadQueue.uploading)

  // Event handlers
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void fileState.processFiles(e.target.files)
      if (e.target.files?.length) setShowConfirmation(true)
    },
    [fileState]
  )

  const handleStartUpload = useCallback(() => {
    setShowConfirmation(false)
    uploadQueue.startUpload()
  }, [uploadQueue])

  const handleCancel = useCallback(() => {
    setShowConfirmation(false)
    fileState.resetFiles()
  }, [fileState])

  const handleReset = useCallback(() => {
    fileState.resetFiles()
    uploadQueue.resetUploadState()
    setShowConfirmation(false)
    setShowSkipped(false)
  }, [fileState, uploadQueue])

  const handleResolveDuplicate = useCallback(
    async (videoPath: string, decision: 'keep_both' | 'replace_existing' | 'cancel_upload') => {
      const video = fileState.videoFiles.find(
        v => v.relativePath === videoPath && v.pendingDuplicateResolution
      )

      if (!video) {
        console.error('[UploadPage] Could not find video for duplicate resolution:', videoPath)
        return
      }

      // For cancel_upload, always remove from UI even if videoId is missing
      if (decision === 'cancel_upload') {
        console.log(`[UploadPage] Canceling upload for ${videoPath}`)

        // Try to call backend if we have videoId (best effort)
        if (video.videoId) {
          try {
            const resolveResponse = await fetch(`/api/uploads/resolve-duplicate/${video.videoId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ decision }),
            })

            if (!resolveResponse.ok) {
              console.warn('[UploadPage] Backend cancel failed, removing from UI anyway')
            }
          } catch (error) {
            console.warn('[UploadPage] Backend cancel error, removing from UI anyway:', error)
          }
        } else {
          console.log('[UploadPage] No videoId, removing from UI only (corrupted upload)')
        }

        // Always remove from UI
        if (video.uploadId) {
          useAppStore.getState().removeUpload(video.uploadId)
        }
        fileState.setVideoFiles(prev => prev.filter(v => v.relativePath !== videoPath))
        return
      }

      // For keep_both and replace_existing, we need videoId to call backend
      if (!video.videoId) {
        console.error(
          '[UploadPage] Cannot resolve duplicate: missing videoId. Use "Cancel Upload" to remove from UI.'
        )
        const action = decision === 'keep_both' ? 'Keep Both' : 'Replace Existing'
        alert(
          `Cannot ${action}: Upload is corrupted (missing video ID).\n\n` +
            `This may happen with uploads from before a system update.\n\n` +
            `Click "Cancel Upload" to remove it from the list.`
        )
        return
      }

      if (!video.duplicateOfVideoId) {
        console.error('[UploadPage] Video has no duplicateOfVideoId:', videoPath)
        alert(
          'Cannot resolve duplicate: Missing duplicate reference.\n\n' +
            'Click "Cancel Upload" to remove this upload from the list.'
        )
        return
      }

      try {
        console.log(`[UploadPage] Resolving duplicate ${video.videoId}: ${decision}`)

        // Call the resolution endpoint
        const resolveResponse = await fetch(`/api/uploads/resolve-duplicate/${video.videoId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ decision }),
        })

        if (!resolveResponse.ok) {
          const errorText = await resolveResponse.text()
          throw new Error(`Server returned ${resolveResponse.status}: ${errorText}`)
        }

        console.log(`[UploadPage] Resolved duplicate ${video.videoId}: ${decision}`)

        // Remove the upload from the store
        if (video.uploadId) {
          console.log(`[UploadPage] Removing upload from store: ${video.uploadId}`)
          useAppStore.getState().removeUpload(video.uploadId)
        }

        // Remove from videoFiles
        console.log(`[UploadPage] Removing from videoFiles: ${videoPath}`)
        fileState.setVideoFiles(prev => {
          const filtered = prev.filter(v => v.relativePath !== videoPath)
          console.log(`[UploadPage] videoFiles count: ${prev.length} -> ${filtered.length}`)
          return filtered
        })
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
    [fileState.videoFiles, fileState.setVideoFiles]
  )

  // Derived state
  const stats = calculateUploadStats(fileState.videoFiles)
  const showDropZone =
    !showConfirmation && !uploadQueue.uploading && fileState.videoFiles.length === 0
  const showConfirmationModal = showConfirmation && !uploadQueue.uploading
  const showProgressSection = fileState.videoFiles.length > 0 && !showConfirmation

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

        {/* Interrupted uploads notification */}
        {showIncompletePrompt && incompleteUploads.length > 0 && (
          <IncompleteUploadsNotification
            uploads={incompleteUploads}
            onDismiss={clearIncompleteUploads}
          />
        )}

        {/* Drop Zone View */}
        {showDropZone && (
          <div className="mt-8">
            <UploadFolderSelector
              selectedFolder={selectedFolder}
              availableFolders={availableFolders}
              onSelect={setSelectedFolder}
            />
            <UploadDropZone
              dragActive={dragDrop.dragActive}
              onDragEnter={dragDrop.handleDragEnter}
              onDragOver={dragDrop.handleDragOver}
              onDragLeave={dragDrop.handleDragLeave}
              onDrop={e => void dragDrop.handleDrop(e)}
              onFileSelect={handleFileSelect}
            />
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirmationModal && (
          <UploadConfirmationModal
            videoFiles={fileState.videoFiles}
            skippedFiles={fileState.skippedFiles}
            showSkipped={showSkipped}
            collapseEnabled={fileState.collapseEnabled}
            collapsesAvailable={fileState.collapsesAvailable}
            selectedFolder={selectedFolder}
            onToggleFileSelection={fileState.toggleFileSelection}
            onSelectAllFiles={fileState.selectAllFiles}
            onDeselectDuplicates={fileState.deselectDuplicates}
            onToggleShowSkipped={() => setShowSkipped(!showSkipped)}
            onToggleCollapse={enabled => void fileState.handleCollapseToggle(enabled)}
            onCancel={handleCancel}
            onStartUpload={handleStartUpload}
          />
        )}

        {/* Upload Progress Section */}
        {showProgressSection && (
          <UploadProgressSection
            videoFiles={fileState.videoFiles}
            uploading={uploadQueue.uploading}
            {...stats}
            onStopQueued={() => uploadQueue.setShowStopQueuedModal(true)}
            onAbortAll={() => uploadQueue.setShowAbortAllModal(true)}
            onReset={handleReset}
            onResolveDuplicate={handleResolveDuplicate}
          />
        )}

        {/* Cancel Modals */}
        <StopQueuedModal
          open={uploadQueue.showStopQueuedModal}
          videoFiles={fileState.videoFiles}
          onClose={() => uploadQueue.setShowStopQueuedModal(false)}
          onConfirm={uploadQueue.handleStopQueued}
        />
        <AbortAllModal
          open={uploadQueue.showAbortAllModal}
          videoFiles={fileState.videoFiles}
          onClose={() => uploadQueue.setShowAbortAllModal(false)}
          onConfirm={uploadQueue.handleAbortAll}
        />
      </div>
    </AppLayout>
  )
}
