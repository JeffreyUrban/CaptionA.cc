/**
 * Pending Duplicates Section - Shows uploads needing duplicate resolution
 *
 * Displays:
 * - List of duplicate videos
 * - Resolution options: Keep Both, Replace Existing, Cancel Upload
 * - Information about what video this duplicates
 */

import type { PendingDuplicate } from '~/stores/upload-store'

interface UploadDuplicatesSectionProps {
  duplicates: PendingDuplicate[]
  onResolveDuplicate: (
    uploadId: string,
    decision: 'keep_both' | 'replace_existing' | 'cancel_upload'
  ) => Promise<void>
}

export function UploadDuplicatesSection({
  duplicates,
  onResolveDuplicate,
}: UploadDuplicatesSectionProps) {
  if (duplicates.length === 0) return null

  return (
    <div className="mt-8 bg-white dark:bg-gray-800 shadow rounded-lg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Pending Duplicates</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {duplicates.length} {duplicates.length === 1 ? 'video needs' : 'videos need'} your
          decision
        </p>
      </div>

      {/* Duplicate List */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {duplicates.map(duplicate => (
          <div key={duplicate.id} className="px-6 py-4">
            {/* File Info */}
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {duplicate.fileName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {duplicate.relativePath}
              </p>
            </div>

            {/* Duplicate Warning */}
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    Duplicate Video Detected
                  </h4>
                  <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">
                    This video is identical to{' '}
                    <span className="font-mono">{duplicate.duplicateOfDisplayPath}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void onResolveDuplicate(duplicate.id, 'keep_both')}
                      className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 transition-colors"
                    >
                      Keep Both
                    </button>
                    <button
                      onClick={() => void onResolveDuplicate(duplicate.id, 'replace_existing')}
                      className="inline-flex items-center px-3 py-1.5 border border-yellow-300 dark:border-yellow-700 text-xs font-medium rounded text-yellow-800 dark:text-yellow-200 bg-white dark:bg-gray-800 hover:bg-yellow-100 hover:border-yellow-400 dark:hover:bg-yellow-900/30 dark:hover:border-yellow-600 transition-colors"
                    >
                      Replace Existing
                    </button>
                    <button
                      onClick={() => void onResolveDuplicate(duplicate.id, 'cancel_upload')}
                      className="inline-flex items-center px-3 py-1.5 border border-red-300 dark:border-red-700 text-xs font-medium rounded text-red-800 dark:text-red-200 bg-white dark:bg-gray-800 hover:bg-red-100 hover:border-red-400 dark:hover:bg-red-900/30 dark:hover:border-red-600 transition-colors"
                    >
                      Cancel Upload
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
