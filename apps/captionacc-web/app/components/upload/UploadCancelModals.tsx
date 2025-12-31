/**
 * Cancel confirmation modals for the upload workflow.
 * Provides modals for stopping queued uploads and aborting all uploads.
 */

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'

import type { VideoFilePreview } from '~/types/upload'

// ============================================================================
// Stop Queued Modal
// ============================================================================

interface StopQueuedModalProps {
  open: boolean
  videoFiles: VideoFilePreview[]
  onClose: () => void
  onConfirm: () => void
}

/**
 * Modal for confirming stopping of queued (pending) uploads.
 */
export function StopQueuedModal({ open, videoFiles, onClose, onConfirm }: StopQueuedModalProps) {
  const pendingCount = videoFiles.filter(v => v.uploadStatus === 'pending').length
  const stalledCount = videoFiles.filter(v => v.uploadStatus === 'stalled').length
  const queuedTotal = pendingCount + stalledCount
  const activeCount = videoFiles.filter(
    v => v.uploadStatus === 'uploading' || v.uploadStatus === 'retrying'
  ).length

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-200">
            Stop Queued Uploads?
          </DialogTitle>
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <p>
              This will cancel {queuedTotal} queued upload{queuedTotal !== 1 ? 's' : ''}.
            </p>
            <p className="mt-2">Uploads currently in progress ({activeCount}) will continue.</p>
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500"
            >
              Stop Queued
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

// ============================================================================
// Abort All Modal
// ============================================================================

interface AbortAllModalProps {
  open: boolean
  videoFiles: VideoFilePreview[]
  onClose: () => void
  onConfirm: () => void
}

/**
 * Modal for confirming aborting of all uploads (including active ones).
 */
export function AbortAllModal({ open, videoFiles, onClose, onConfirm }: AbortAllModalProps) {
  const activeCount = videoFiles.filter(
    v => v.uploadStatus === 'uploading' || v.uploadStatus === 'retrying'
  ).length
  const queuedCount = videoFiles.filter(
    v => v.uploadStatus === 'pending' || v.uploadStatus === 'stalled'
  ).length
  const completedCount = videoFiles.filter(v => v.uploadStatus === 'complete').length

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
          <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-200">
            Abort All Uploads?
          </DialogTitle>
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <p>This will immediately stop all uploads in progress and cancel all queued uploads.</p>
            <div className="mt-3 space-y-1 text-xs">
              <p>Currently uploading/retrying: {activeCount}</p>
              <p>Queued: {queuedCount}</p>
              <p>Already completed: {completedCount} (will be kept)</p>
            </div>
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-500"
            >
              Abort All
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
