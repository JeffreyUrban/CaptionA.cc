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
import { useIncompleteUploads } from '~/hooks/useIncompleteUploads'
import { useUploadDragDrop } from '~/hooks/useUploadDragDrop'
import { useUploadFiles } from '~/hooks/useUploadFiles'
import { useUploadFolders } from '~/hooks/useUploadFolders'
import { useUploadQueue } from '~/hooks/useUploadQueue'
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
  const { incompleteUploads, showIncompletePrompt, dismissIncompletePrompt } =
    useIncompleteUploads()
  const fileState = useUploadFiles(false)
  const uploadQueue = useUploadQueue(fileState.videoFiles, fileState.setVideoFiles, selectedFolder)

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
    setShowConfirmation(false)
    setShowSkipped(false)
  }, [fileState])

  // Derived state
  const stats = calculateUploadStats(fileState.videoFiles)
  const showDropZone =
    !showConfirmation && !uploadQueue.uploading && fileState.videoFiles.length === 0
  const showConfirmationModal = showConfirmation && !uploadQueue.uploading
  const showProgressSection =
    (uploadQueue.uploading || fileState.videoFiles.length > 0) && !showConfirmation

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
            onDismiss={dismissIncompletePrompt}
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
