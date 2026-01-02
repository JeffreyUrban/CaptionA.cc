/**
 * Upload Badge - Header notification for upload progress and pending duplicates
 *
 * Displays:
 * - Upload progress (active uploads)
 * - Action required indicator (pending duplicates)
 * - Completion status
 *
 * Behavior:
 * - Shows when uploads are active or duplicates need resolution
 * - Dismissible via X button
 * - Clicking badge navigates to /upload page
 * - Auto-hides when visiting /upload page
 * - Persists across navigation (sessionStorage)
 */

import { Link } from 'react-router'

import { useUploadStore } from '~/stores/upload-store'

export function UploadBadge() {
  const notification = useUploadStore(state => state.notification)
  const dismissNotification = useUploadStore(state => state.dismissNotification)

  // Don't render if notification is hidden
  if (!notification.show) return null

  const { hasActiveUploads, hasPendingDuplicates, completedCount, totalCount, progress } =
    notification

  // Determine badge state
  const needsAction = hasPendingDuplicates && !hasActiveUploads
  const isComplete = !hasActiveUploads && !hasPendingDuplicates && completedCount > 0

  // Badge color based on state
  const badgeColor = needsAction
    ? 'bg-yellow-500 dark:bg-yellow-600'
    : isComplete
      ? 'bg-green-500 dark:bg-green-600'
      : 'bg-blue-500 dark:bg-blue-600'

  // Badge text
  const badgeText = needsAction
    ? 'Action Required'
    : isComplete
      ? 'Upload Complete'
      : `Uploading ${completedCount}/${totalCount}`

  return (
    <div className="fixed top-20 right-4 z-50 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Link
          to="/upload"
          className="flex-1 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <span className={`inline-block w-2 h-2 rounded-full ${badgeColor}`} />
          {badgeText}
        </Link>

        <button
          onClick={dismissNotification}
          className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Dismiss notification"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Progress Details */}
      <div className="px-4 py-3">
        {/* Active Uploads */}
        {hasActiveUploads && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
              <span>
                {completedCount} of {totalCount} files
              </span>
              <span>{progress}%</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 dark:bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Pending Duplicates */}
        {hasPendingDuplicates && !hasActiveUploads && (
          <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-300">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <span>Duplicate videos need resolution</span>
          </div>
        )}

        {/* Upload Complete */}
        {isComplete && (
          <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            <span>
              {completedCount} {completedCount === 1 ? 'file' : 'files'} uploaded successfully
            </span>
          </div>
        )}

        {/* View Details Link */}
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <Link
            to="/upload"
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            View details →
          </Link>
        </div>
      </div>
    </div>
  )
}
