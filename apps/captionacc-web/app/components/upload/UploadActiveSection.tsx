/**
 * Active Uploads Section - Shows uploads in progress
 *
 * Displays:
 * - Upload progress for each file
 * - Overall progress summary
 * - Cancel/abort controls
 */

import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/20/solid'

import type { ActiveUpload } from '~/stores/upload-store'
import { formatBytes } from '~/utils/upload-helpers'

interface UploadActiveSectionProps {
  uploads: ActiveUpload[]
  onCancelQueued: () => void
  onAbortAll: () => void
  onCancelUpload: (uploadId: string) => void
  onRetryUpload: (uploadId: string) => void
}

export function UploadActiveSection({
  uploads,
  onCancelQueued,
  onAbortAll,
  onCancelUpload,
  onRetryUpload,
}: UploadActiveSectionProps) {
  if (uploads.length === 0) return null

  const uploadingCount = uploads.filter(u => u.status === 'uploading').length
  const pendingCount = uploads.filter(u => u.status === 'pending').length
  const errorCount = uploads.filter(u => u.status === 'error').length

  // Calculate overall progress
  let totalBytes = 0
  let uploadedBytes = 0
  uploads.forEach(upload => {
    totalBytes += upload.fileSize
    uploadedBytes += upload.bytesUploaded
  })
  const overallProgress = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0

  return (
    <div className="mt-8 bg-white dark:bg-gray-800 shadow rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Active Uploads</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {uploadingCount} uploading, {pendingCount} queued
              {errorCount > 0 && `, ${errorCount} failed`}
            </p>
          </div>

          <div className="flex gap-2">
            {pendingCount > 0 && (
              <button
                onClick={onCancelQueued}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600"
              >
                Cancel Queued ({pendingCount})
              </button>
            )}
            <button
              onClick={onAbortAll}
              className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
            >
              Abort All
            </button>
          </div>
        </div>

        {/* Overall Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
            <span>Overall Progress</span>
            <span>{overallProgress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 dark:bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Upload List */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {uploads.map(upload => (
          <div key={upload.id} className="px-6 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {upload.fileName}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {upload.relativePath}
                </p>
              </div>

              <div className="ml-4 flex items-center gap-3">
                {/* Status Badge */}
                {upload.status === 'uploading' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    Uploading
                  </span>
                )}
                {upload.status === 'pending' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                    Queued
                  </span>
                )}
                {upload.status === 'error' && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    Error
                  </span>
                )}

                {/* File Size */}
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {formatBytes(upload.fileSize)}
                </span>

                {/* Action Buttons */}
                <div className="flex items-center gap-1">
                  {/* Retry button for failed uploads */}
                  {upload.status === 'error' && (
                    <button
                      onClick={() => onRetryUpload(upload.id)}
                      className="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      title="Retry upload"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                    </button>
                  )}

                  {/* Cancel button for pending/uploading */}
                  {(upload.status === 'pending' || upload.status === 'uploading') && (
                    <button
                      onClick={() => onCancelUpload(upload.id)}
                      className="p-1.5 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Cancel upload"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {upload.status === 'uploading' && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                  <span>
                    {formatBytes(upload.bytesUploaded)} of {formatBytes(upload.fileSize)}
                  </span>
                  <span>{upload.progress}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 dark:bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Message */}
            {upload.status === 'error' && upload.error && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-700 dark:text-red-300">
                {upload.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
