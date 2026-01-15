/**
 * Confirmation modal component for the upload workflow.
 * Shows file list, stats, duplicate warnings, and upload options.
 */

import { XMarkIcon } from '@heroicons/react/24/outline'

import type { VideoFilePreview, FileWithPath } from '~/types/upload'
import {
  formatBytes,
  formatDuration,
  calculateTargetPath,
  getOriginalPath,
} from '~/utils/upload-helpers'

// ============================================================================
// Sub-components
// ============================================================================

/**
 * File list table showing videos to be uploaded
 */
function FileListTable({
  videoFiles,
  selectedFolder,
  onToggleFileSelection,
  onSelectAllFiles,
}: {
  videoFiles: VideoFilePreview[]
  selectedFolder: string
  onToggleFileSelection: (index: number) => void
  onSelectAllFiles: (selected: boolean) => void
}) {
  const selectedVideos = videoFiles.filter(v => v.selected)

  return (
    <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10 rounded-lg max-h-96 overflow-y-auto">
      <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
          <tr>
            <th className="py-3 pl-4 pr-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 sm:pl-6">
              <input
                type="checkbox"
                checked={selectedVideos.length === videoFiles.length}
                onChange={e => onSelectAllFiles(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
              Original Path
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
              Target Path
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
              Size
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
          {videoFiles.map((video, index) => (
            <tr
              key={index}
              className={`hover:bg-gray-50 dark:hover:bg-gray-900 ${video.isDuplicate ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}`}
            >
              <td className="py-3 pl-4 pr-3 sm:pl-6">
                <input
                  type="checkbox"
                  checked={video.selected}
                  onChange={() => onToggleFileSelection(index)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                />
              </td>
              <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
                {getOriginalPath(video)}
              </td>
              <td className="px-3 py-3 text-sm text-gray-900 dark:text-gray-200 font-medium">
                {calculateTargetPath(video, selectedFolder)}
              </td>
              <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
                {formatBytes(video.size)}
              </td>
              <td className="px-3 py-3 text-sm">
                {video.isDuplicate ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Path exists
                  </span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-600">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Warning banner for duplicate file paths
 */
function DuplicateWarning({
  duplicateCount,
  onDeselectAll,
}: {
  duplicateCount: number
  onDeselectAll: () => void
}) {
  return (
    <div className="mt-4 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 border border-yellow-200 dark:border-yellow-800">
      <div className="flex">
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
          <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
            Path conflict detected
          </h3>
          <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
            <p>
              {duplicateCount} video{duplicateCount !== 1 ? 's target' : ' targets'} the same path
              as existing {duplicateCount !== 1 ? 'videos' : 'video'}. Uploading will overwrite the
              existing video and all annotation data at{' '}
              {duplicateCount !== 1 ? 'these paths' : 'this path'}.
            </p>
          </div>
          <div className="mt-3">
            <button
              onClick={onDeselectAll}
              className="text-sm font-medium text-yellow-800 dark:text-yellow-300 hover:text-yellow-700 dark:hover:text-yellow-200 underline"
            >
              Deselect all duplicates
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Statistics cards for the upload summary
 */
function UploadStatsCards({
  selectedCount,
  totalSize,
  estimatedSeconds,
}: {
  selectedCount: number
  totalSize: number
  estimatedSeconds: number
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 rounded-md">
        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Selected Videos</div>
        <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-200">
          {selectedCount}
        </div>
      </div>
      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 rounded-md">
        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Size</div>
        <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-200">
          {formatBytes(totalSize)}
        </div>
      </div>
      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 rounded-md">
        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Est. Time</div>
        <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-200">
          ~{formatDuration(estimatedSeconds)}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

interface UploadConfirmationModalProps {
  videoFiles: VideoFilePreview[]
  skippedFiles: File[]
  showSkipped: boolean
  collapseEnabled: boolean
  collapsesAvailable: boolean
  selectedFolder: string
  onToggleFileSelection: (index: number) => void
  onSelectAllFiles: (selected: boolean) => void
  onDeselectDuplicates: () => void
  onToggleShowSkipped: () => void
  onToggleCollapse: (enabled: boolean) => void
  onCancel: () => void
  onStartUpload: () => void
}

/**
 * Modal for confirming video uploads with file list and options.
 */
export function UploadConfirmationModal({
  videoFiles,
  skippedFiles,
  showSkipped,
  collapseEnabled,
  collapsesAvailable,
  selectedFolder,
  onToggleFileSelection,
  onSelectAllFiles,
  onDeselectDuplicates,
  onToggleShowSkipped,
  onToggleCollapse,
  onCancel,
  onStartUpload,
}: UploadConfirmationModalProps) {
  const selectedVideos = videoFiles.filter(f => f.selected)
  const totalSize = selectedVideos.reduce((sum, f) => sum + f.size, 0)
  const estimatedSeconds = totalSize / (1.25 * 1024 * 1024) // Assumes 10 Mbps
  const duplicateCount = videoFiles.filter(v => v.isDuplicate).length

  return (
    <div className="mt-8 bg-white dark:bg-gray-800 shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-200">
          Confirm Video Upload
        </h3>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Found {videoFiles.length} video{videoFiles.length !== 1 ? 's' : ''}
          {skippedFiles.length > 0 && ` (${skippedFiles.length} non-video files skipped)`}
        </div>

        {/* Duplicate Warning */}
        {duplicateCount > 0 && (
          <DuplicateWarning duplicateCount={duplicateCount} onDeselectAll={onDeselectDuplicates} />
        )}

        {/* Folder Collapse Toggle */}
        {collapsesAvailable && (
          <div className="mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={collapseEnabled}
                onChange={e => onToggleCollapse(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Collapse single-video folders
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500">
                (simplifies folder structure)
              </span>
            </label>
          </div>
        )}

        {/* Stats */}
        <UploadStatsCards
          selectedCount={selectedVideos.length}
          totalSize={totalSize}
          estimatedSeconds={estimatedSeconds}
        />

        {/* File List */}
        <div className="mt-6">
          <FileListTable
            videoFiles={videoFiles}
            selectedFolder={selectedFolder}
            onToggleFileSelection={onToggleFileSelection}
            onSelectAllFiles={onSelectAllFiles}
          />
        </div>

        {/* Skipped Files */}
        {skippedFiles.length > 0 && (
          <button
            onClick={onToggleShowSkipped}
            className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
          >
            {showSkipped ? 'Hide' : 'View'} skipped files ({skippedFiles.length})
          </button>
        )}

        {showSkipped && (
          <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-md p-4">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-200 mb-2">
              Skipped Files
            </h4>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              {skippedFiles.map((file, index) => (
                <li key={index} className="flex items-center gap-2">
                  <XMarkIcon className="h-4 w-4 text-gray-400" />
                  {(file as FileWithPath).webkitRelativePath ?? file.name} ({file.type || 'unknown'}
                  )
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onStartUpload}
            disabled={selectedVideos.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload {selectedVideos.length} Video{selectedVideos.length !== 1 ? 's' : ''}
          </button>
        </div>

        {/* Info */}
        <div className="mt-4 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-md border border-amber-200 dark:border-amber-800">
          <strong>Keep this page open during uploads.</strong> Closing or navigating away will stop
          uploads. They cannot resume automatically.
        </div>
      </div>
    </div>
  )
}
