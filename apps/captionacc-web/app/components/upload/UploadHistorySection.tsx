/**
 * Upload History Section - Shows completed uploads for current session
 *
 * Displays:
 * - List of successfully uploaded files
 * - Clear history button
 * - Virtual paths without extensions
 */

import type { CompletedUpload } from '~/stores/upload-store'

interface UploadHistorySectionProps {
  uploads: CompletedUpload[]
  onClearHistory: () => void
}

export function UploadHistorySection({ uploads, onClearHistory }: UploadHistorySectionProps) {
  if (uploads.length === 0) return null

  // Helper to remove extension from path
  const getPathWithoutExtension = (path: string): string => {
    const lastDotIndex = path.lastIndexOf('.')
    const lastSlashIndex = path.lastIndexOf('/')
    // Only remove extension if dot comes after last slash (not a hidden folder)
    if (lastDotIndex > lastSlashIndex && lastDotIndex > 0) {
      return path.substring(0, lastDotIndex)
    }
    return path
  }

  return (
    <div className="mt-8 bg-white dark:bg-gray-800 shadow rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Upload History</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {uploads.length} {uploads.length === 1 ? 'file' : 'files'} uploaded this session
            </p>
          </div>

          <button
            onClick={onClearHistory}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600"
          >
            Clear History
          </button>
        </div>
      </div>

      {/* Upload List */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {uploads.map(upload => (
          <div key={upload.id} className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {getPathWithoutExtension(upload.relativePath)}
                </p>
              </div>

              <div className="ml-4 flex items-center gap-3">
                {/* Success Badge */}
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Complete
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
