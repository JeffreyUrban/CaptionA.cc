/**
 * Lock Acquisition Modal Component
 *
 * Shows a modal during the lock acquisition process:
 * - Loading spinner while acquiring
 * - Error state if denied (with holder info)
 * - Retry button for failed attempts
 * - Auto-closes on success
 */

import { useEffect, useState } from 'react'

import type { LockDisplayState, LockHolderInfo } from './DatabaseLockBanner'

// =============================================================================
// Types
// =============================================================================

export interface LockAcquisitionModalProps {
  /** Whether the modal should be shown */
  isOpen: boolean
  /** Current lock state */
  lockState: LockDisplayState
  /** Lock holder info (if denied) */
  lockHolder: LockHolderInfo | null
  /** Error message (if any) */
  error: string | null
  /** Download progress (if downloading database) */
  downloadProgress?: {
    phase: 'downloading' | 'decompressing' | 'complete' | 'error'
    percent: number
    bytesDownloaded: number
    totalBytes: number | null
  } | null
  /** Callback to retry lock acquisition */
  onRetry: () => void
  /** Callback to continue in read-only mode */
  onContinueReadOnly: () => void
  /** Callback to close (only available after acquisition or read-only decision) */
  onClose?: () => void
}

// =============================================================================
// Component
// =============================================================================

// eslint-disable-next-line max-lines-per-function -- UI component with multiple render states and helper functions
export function LockAcquisitionModal({
  isOpen,
  lockState,
  lockHolder,
  error,
  downloadProgress,
  onRetry,
  onContinueReadOnly,
  onClose,
}: LockAcquisitionModalProps) {
  // Track retry count for exponential backoff display
  const [_retryCount, setRetryCount] = useState(0)

  // Auto-close on success
  useEffect((): (() => void) | void => {
    if (lockState === 'granted' && onClose) {
      // Small delay to show success state
      const timer = setTimeout(() => {
        onClose()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [lockState, onClose])

  if (!isOpen) {
    return null
  }

  // Determine what content to show
  // eslint-disable-next-line max-lines-per-function -- Content renderer with multiple state branches for modal UI
  const renderContent = (): React.ReactNode => {
    // Error state
    if (error) {
      return (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg
              className="h-6 w-6 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">
            Failed to Load Database
          </h3>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{error}</p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => {
                setRetryCount(c => c + 1)
                onRetry()
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
            <button
              onClick={onContinueReadOnly}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      )
    }

    // Lock denied state
    if (lockState === 'denied') {
      const holderName = lockHolder?.displayName ?? lockHolder?.userId ?? 'Another user'

      return (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
            <svg
              className="h-6 w-6 text-yellow-600 dark:text-yellow-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">
            Database Locked
          </h3>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            <strong>{holderName}</strong> is currently editing this video.
            <br />
            You can view the content in read-only mode or request the lock.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={onContinueReadOnly}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Continue Read-Only
            </button>
            <button
              onClick={() => {
                setRetryCount(c => c + 1)
                onRetry()
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Request Lock
            </button>
          </div>
        </div>
      )
    }

    // Lock granted state (brief success message)
    if (lockState === 'granted') {
      return (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
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
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">Ready to Edit</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You have acquired the editing lock.
          </p>
        </div>
      )
    }

    // Loading/acquiring state
    return (
      <div className="text-center">
        {/* Spinner */}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <svg className="h-10 w-10 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>

        {/* Status text */}
        <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">
          {getLoadingTitle()}
        </h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{getLoadingMessage()}</p>

        {/* Progress bar for downloads */}
        {downloadProgress && downloadProgress.phase !== 'complete' && (
          <div className="mx-auto max-w-xs">
            <div className="mb-1 flex justify-between text-xs text-gray-500">
              <span>
                {downloadProgress.phase === 'downloading' ? 'Downloading' : 'Decompressing'}
              </span>
              <span>{downloadProgress.percent}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
            {downloadProgress.totalBytes && (
              <p className="mt-1 text-xs text-gray-500">
                {formatBytes(downloadProgress.bytesDownloaded)} /{' '}
                {formatBytes(downloadProgress.totalBytes)}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  const getLoadingTitle = () => {
    if (downloadProgress?.phase === 'downloading') {
      return 'Downloading Database'
    }
    if (downloadProgress?.phase === 'decompressing') {
      return 'Preparing Database'
    }

    switch (lockState) {
      case 'loading':
        return 'Loading Database'
      case 'checking':
        return 'Checking Lock Status'
      case 'acquiring':
        return 'Acquiring Edit Lock'
      case 'transferring':
        return 'Transferring Session'
      default:
        return 'Preparing...'
    }
  }

  const getLoadingMessage = () => {
    if (downloadProgress?.phase === 'downloading') {
      return 'Downloading the layout database for offline editing...'
    }
    if (downloadProgress?.phase === 'decompressing') {
      return 'Decompressing and initializing the database...'
    }

    switch (lockState) {
      case 'loading':
        return 'Please wait while we load the layout database...'
      case 'checking':
        return 'Checking if the database is available for editing...'
      case 'acquiring':
        return 'Requesting exclusive access for editing...'
      case 'transferring':
        return 'Transferring the session from another tab...'
      default:
        return 'This may take a moment...'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        {renderContent()}
      </div>
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format bytes to human-readable size.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
