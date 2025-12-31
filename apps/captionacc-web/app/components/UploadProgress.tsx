/**
 * UploadProgress - Global upload/processing indicator for navbar
 *
 * Shows active uploads and background processing from any page.
 * Visible in navbar, provides at-a-glance status of ongoing operations.
 */

import { Transition } from '@headlessui/react'
import { ArrowUpTrayIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { Fragment } from 'react'
import { Link } from 'react-router'

import { useAppStore, selectActiveOperationCount } from '~/stores/app-store'
import type { UploadMetadata } from '~/types/store'

// ============================================================================
// Types
// ============================================================================

interface UploadProgressProps {
  /** If true, shows expanded view with all uploads */
  expanded?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getUploadStatusColor(status: UploadMetadata['status']): string {
  switch (status) {
    case 'uploading':
      return 'bg-blue-500'
    case 'completed':
      return 'bg-green-500'
    case 'failed':
    case 'cancelled':
      return 'bg-red-500'
    default:
      return 'bg-gray-400'
  }
}

function getUploadStatusText(upload: UploadMetadata): string {
  switch (upload.status) {
    case 'pending':
      return 'Queued'
    case 'uploading':
      return `${Math.round(upload.progress)}%`
    case 'completed':
      return 'Complete'
    case 'failed':
      return upload.error ?? 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

// ============================================================================
// Components
// ============================================================================

/**
 * Compact badge showing active operation count
 */
function OperationBadge({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <Link
      to="/upload"
      className="group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      aria-label={`${count} active operations`}
    >
      <div className="relative">
        <ArrowUpTrayIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
          {count}
        </span>
      </div>
      <span className="hidden sm:inline">Uploading</span>
    </Link>
  )
}

/**
 * Single upload progress item
 */
function UploadItem({ upload }: { upload: UploadMetadata }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      {/* Status indicator */}
      <div className="flex-shrink-0">
        {upload.status === 'completed' && <CheckCircleIcon className="h-5 w-5 text-green-500" />}
        {(upload.status === 'failed' || upload.status === 'cancelled') && (
          <XCircleIcon className="h-5 w-5 text-red-500" />
        )}
        {(upload.status === 'uploading' || upload.status === 'pending') && (
          <div
            className={`h-3 w-3 rounded-full ${getUploadStatusColor(upload.status)} animate-pulse`}
          />
        )}
      </div>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
          {upload.fileName}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatFileSize(upload.fileSize)} • {getUploadStatusText(upload)}
        </p>
      </div>

      {/* Progress bar */}
      {upload.status === 'uploading' && (
        <div className="w-24 flex-shrink-0">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Expanded upload list panel
 */
function ExpandedPanel({ uploads }: { uploads: UploadMetadata[] }) {
  if (uploads.length === 0) return null

  const activeUploads = uploads.filter(u => u.status === 'uploading' || u.status === 'pending')
  const completedUploads = uploads.filter(u => u.status === 'completed')
  const failedUploads = uploads.filter(u => u.status === 'failed' || u.status === 'cancelled')

  return (
    <div className="space-y-4">
      {/* Active uploads */}
      {activeUploads.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
            Uploading ({activeUploads.length})
          </h3>
          <div className="space-y-2">
            {activeUploads.map(upload => (
              <UploadItem key={upload.id} upload={upload} />
            ))}
          </div>
        </div>
      )}

      {/* Completed uploads */}
      {completedUploads.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
            Completed ({completedUploads.length})
          </h3>
          <div className="space-y-2">
            {completedUploads.slice(0, 3).map(upload => (
              <UploadItem key={upload.id} upload={upload} />
            ))}
            {completedUploads.length > 3 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                + {completedUploads.length - 3} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Failed uploads */}
      {failedUploads.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
            Failed ({failedUploads.length})
          </h3>
          <div className="space-y-2">
            {failedUploads.map(upload => (
              <UploadItem key={upload.id} upload={upload} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function UploadProgress({ expanded = false }: UploadProgressProps) {
  // Subscribe to store
  const activeOperationCount = useAppStore(selectActiveOperationCount)
  const allUploads = useAppStore(state => Object.values(state.uploads))

  // Render compact badge if not expanded
  if (!expanded) {
    return <OperationBadge count={activeOperationCount} />
  }

  // Render expanded panel
  return (
    <Transition
      show={allUploads.length > 0}
      as={Fragment}
      enter="transition ease-out duration-200"
      enterFrom="opacity-0 translate-y-1"
      enterTo="opacity-100 translate-y-0"
      leave="transition ease-in duration-150"
      leaveFrom="opacity-100 translate-y-0"
      leaveTo="opacity-0 translate-y-1"
    >
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Upload Progress</h2>
          <Link
            to="/upload"
            className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            View All
          </Link>
        </div>
        <ExpandedPanel uploads={allUploads} />
      </div>
    </Transition>
  )
}
