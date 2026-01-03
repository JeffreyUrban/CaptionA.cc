/**
 * UploadProgress - Global upload/processing indicator for navbar
 *
 * Shows active uploads from any page.
 * Visible in navbar, provides at-a-glance status of ongoing operations.
 */

import { ArrowUpTrayIcon } from '@heroicons/react/24/outline'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { useUploadStore } from '~/stores/upload-store'

export function UploadProgress() {
  // Get upload state from the new upload-store
  const activeUploadsObj = useUploadStore(state => state.activeUploads)
  const pendingDuplicatesObj = useUploadStore(state => state.pendingDuplicates)
  const completedUploads = useUploadStore(state => state.completedUploads)

  // Convert to arrays
  const activeUploads = useMemo(() => Object.values(activeUploadsObj), [activeUploadsObj])
  const pendingDuplicates = useMemo(
    () => Object.values(pendingDuplicatesObj),
    [pendingDuplicatesObj]
  )

  // Count completed uploads (successful)
  const completedCount = completedUploads.length

  // Count total uploads (active + pending duplicates + completed)
  const totalCount = activeUploads.length + pendingDuplicates.length + completedCount

  // Don't show if no uploads at all
  if (totalCount === 0) return null

  // If there are active operations (uploading or pending duplicates), show progress
  const hasActiveOperations = activeUploads.length > 0 || pendingDuplicates.length > 0

  if (!hasActiveOperations) return null

  return (
    <Link
      to="/upload"
      className="group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      aria-label={`${completedCount} of ${totalCount} uploads complete`}
    >
      <ArrowUpTrayIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
      <span className="hidden sm:inline">
        Uploading {completedCount}/{totalCount}
      </span>
    </Link>
  )
}
