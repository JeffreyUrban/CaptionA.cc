/**
 * Progress section component for the upload workflow.
 * Displays upload progress, status breakdown, and file cards.
 */

import { Link } from 'react-router'

import type { VideoFilePreview, IncompleteUpload } from '~/types/upload'
import { formatBytes, isVideoInProgress, isVideoFinished } from '~/utils/upload-helpers'

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Status breakdown showing upload counts by state
 */
function UploadStatusBreakdown({
  uploadingCount,
  retryingCount,
  pendingCount,
  stalledCount,
  errorCount,
}: {
  uploadingCount: number
  retryingCount: number
  pendingCount: number
  stalledCount: number
  errorCount: number
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs">
      {uploadingCount > 0 && (
        <span className="text-blue-600 dark:text-blue-400">Uploading: {uploadingCount}</span>
      )}
      {retryingCount > 0 && (
        <span className="text-yellow-600 dark:text-yellow-400">Retrying: {retryingCount}</span>
      )}
      {pendingCount > 0 && (
        <span className="text-gray-500 dark:text-gray-400">Pending: {pendingCount}</span>
      )}
      {stalledCount > 0 && (
        <span className="text-orange-600 dark:text-orange-400">Stalled: {stalledCount}</span>
      )}
      {errorCount > 0 && (
        <span className="text-red-600 dark:text-red-400">Failed: {errorCount}</span>
      )}
    </div>
  )
}

/**
 * Status badge for a single video
 */
function VideoStatusBadge({ video }: { video: VideoFilePreview }) {
  const { uploadStatus, uploadProgress, error } = video

  if (uploadStatus === 'uploading') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
        Uploading {Math.round(uploadProgress)}%
      </span>
    )
  }

  if (uploadStatus === 'retrying') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        Retrying...
      </span>
    )
  }

  if (uploadStatus === 'stalled') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
        Stalled
      </span>
    )
  }

  if (uploadStatus === 'pending') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
        Pending
      </span>
    )
  }

  if (uploadStatus === 'complete') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
        Complete
      </span>
    )
  }

  if (uploadStatus === 'error') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        {error === 'Cancelled by user' ? 'Cancelled' : 'Error'}
      </span>
    )
  }

  return null
}

/**
 * Card showing progress for a single video
 */
function VideoProgressCard({
  video,
  showProgress,
  onResolveDuplicate,
}: {
  video: VideoFilePreview
  showProgress: boolean
  onResolveDuplicate?: (
    videoPath: string,
    decision: 'keep_both' | 'replace_existing' | 'cancel_upload'
  ) => void
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-200 truncate">
            {video.relativePath}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            {formatBytes(video.size)} - {video.type}
          </p>
        </div>
        <div className="ml-4">
          <VideoStatusBadge video={video} />
        </div>
      </div>

      {showProgress && video.uploadStatus === 'uploading' && (
        <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-indigo-600 h-1.5 rounded-full transition-all"
            style={{ width: `${video.uploadProgress}%` }}
          />
        </div>
      )}

      {video.error && video.uploadStatus === 'error' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{video.error}</p>
      )}

      {/* Duplicate Resolution Warning */}
      {video.pendingDuplicateResolution && video.duplicateOfDisplayPath && (
        <div className="mt-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
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
                <span className="font-mono">{video.duplicateOfDisplayPath}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => onResolveDuplicate?.(video.relativePath, 'keep_both')}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Keep Both
                </button>
                <button
                  onClick={() => onResolveDuplicate?.(video.relativePath, 'replace_existing')}
                  className="inline-flex items-center px-3 py-1.5 border border-yellow-300 dark:border-yellow-700 text-xs font-medium rounded text-yellow-700 dark:text-yellow-300 bg-white dark:bg-gray-800 hover:bg-yellow-100 hover:border-yellow-400 dark:hover:bg-yellow-900/50 dark:hover:border-yellow-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors"
                >
                  Replace Existing
                </button>
                <button
                  onClick={() => onResolveDuplicate?.(video.relativePath, 'cancel_upload')}
                  className="inline-flex items-center px-3 py-1.5 border border-red-300 dark:border-red-700 text-xs font-medium rounded text-red-700 dark:text-red-300 bg-white dark:bg-gray-800 hover:bg-red-100 hover:border-red-400 dark:hover:bg-red-900/50 dark:hover:border-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                >
                  Cancel Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Notification banner for incomplete uploads from previous session
 */
export function IncompleteUploadsNotification({
  uploads,
  onDismiss,
}: {
  uploads: IncompleteUpload[]
  onDismiss: () => void
}) {
  return (
    <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Found {uploads.length} interrupted upload{uploads.length !== 1 ? 's' : ''} from previous
            session
          </h3>
          <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
            <p className="mb-2">These uploads were interrupted when the page was closed:</p>
            <details className="mt-2">
              <summary className="cursor-pointer font-medium hover:text-blue-800 dark:hover:text-blue-200">
                View list ({uploads.length} videos)
              </summary>
              <ul className="mt-2 space-y-1 ml-4 text-xs max-h-48 overflow-y-auto">
                {uploads.map((upload: IncompleteUpload) => (
                  <li key={upload.uploadId} className="flex justify-between">
                    <span className="font-mono">{upload.videoPath}</span>
                    <span className="text-blue-600 dark:text-blue-400 ml-2">
                      {Math.round(upload.progress * 100)}% complete
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <div className="mt-4">
            <button
              onClick={onDismiss}
              className="text-sm font-semibold text-blue-800 dark:text-blue-200 hover:text-blue-900 dark:hover:text-blue-100"
            >
              Acknowledge & Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Success banner when all uploads complete
 */
function UploadCompleteBanner({
  videoCount,
  onReset,
}: {
  videoCount: number
  onReset: () => void
}) {
  return (
    <div className="mt-6 rounded-lg bg-green-50 dark:bg-green-900/20 p-6 border border-green-200 dark:border-green-800">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-6 w-6 text-green-600 dark:text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-green-800 dark:text-green-300">
            Upload complete!
          </h3>
          <div className="mt-2 text-sm text-green-700 dark:text-green-400">
            <p>
              Successfully uploaded {videoCount} video
              {videoCount !== 1 ? 's' : ''}. Background processing (frame extraction and OCR) has
              started automatically.
            </p>
          </div>
          <div className="mt-4 flex gap-3">
            <Link
              to="/videos"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              View Videos & Processing Status
            </Link>
            <button
              onClick={onReset}
              className="inline-flex items-center px-4 py-2 border border-green-300 dark:border-green-700 text-sm font-medium rounded-md text-green-700 dark:text-green-300 bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
            >
              Upload More Videos
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

interface UploadProgressSectionProps {
  videoFiles: VideoFilePreview[]
  uploading: boolean
  selectedCount: number
  completedCount: number
  errorCount: number
  uploadingCount: number
  retryingCount: number
  pendingCount: number
  stalledCount: number
  overallProgress: number
  onStopQueued: () => void
  onAbortAll: () => void
  onReset: () => void
  onResolveDuplicate?: (
    videoPath: string,
    decision: 'keep_both' | 'replace_existing' | 'cancel_upload'
  ) => void
}

/**
 * Section showing upload progress with file cards and status.
 */
export function UploadProgressSection({
  videoFiles,
  uploading,
  selectedCount,
  completedCount,
  errorCount,
  uploadingCount,
  retryingCount,
  pendingCount,
  stalledCount,
  overallProgress,
  onStopQueued,
  onAbortAll,
  onReset,
  onResolveDuplicate,
}: UploadProgressSectionProps) {
  const selectedVideos = videoFiles.filter(v => v.selected)
  const inProgressVideos = selectedVideos.filter(isVideoInProgress)
  const finishedVideos = selectedVideos.filter(isVideoFinished)
  const allComplete = completedCount === selectedCount && completedCount > 0

  return (
    <div className="mt-8 bg-white dark:bg-gray-800 shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-200">
            {uploading
              ? `Uploading ${selectedCount} video${selectedCount !== 1 ? 's' : ''}...`
              : 'Upload Complete'}
          </h3>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {completedCount} of {selectedCount} complete ({Math.round(overallProgress)}%)
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mt-4 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full transition-all"
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        {/* Status breakdown */}
        {uploading &&
          (uploadingCount > 0 ||
            retryingCount > 0 ||
            pendingCount > 0 ||
            stalledCount > 0 ||
            errorCount > 0) && (
            <UploadStatusBreakdown
              uploadingCount={uploadingCount}
              retryingCount={retryingCount}
              pendingCount={pendingCount}
              stalledCount={stalledCount}
              errorCount={errorCount}
            />
          )}

        {/* Cancel buttons */}
        {uploading &&
          (uploadingCount > 0 || retryingCount > 0 || pendingCount > 0 || stalledCount > 0) && (
            <div className="mt-4 flex flex-wrap gap-3">
              {(pendingCount > 0 || stalledCount > 0) && (
                <button
                  onClick={onStopQueued}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Stop Queued ({pendingCount + stalledCount})
                </button>
              )}
              <button
                onClick={onAbortAll}
                className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30"
              >
                Abort All Uploads
              </button>
            </div>
          )}

        {/* File List - Two Section Layout */}
        <div className="mt-6 space-y-6">
          {/* In Progress Section */}
          {inProgressVideos.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 mb-3">
                In Progress ({inProgressVideos.length})
              </h4>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {inProgressVideos.map((video, idx) => (
                  <VideoProgressCard
                    key={`progress-${idx}`}
                    video={video}
                    showProgress={true}
                    onResolveDuplicate={onResolveDuplicate}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Finished Section */}
          {finishedVideos.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 mb-3">
                Finished ({finishedVideos.length})
              </h4>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {finishedVideos.map((video, idx) => (
                  <VideoProgressCard
                    key={`finished-${idx}`}
                    video={video}
                    showProgress={false}
                    onResolveDuplicate={onResolveDuplicate}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Success Banner */}
        {allComplete && <UploadCompleteBanner videoCount={selectedCount} onReset={onReset} />}
      </div>
    </div>
  )
}
