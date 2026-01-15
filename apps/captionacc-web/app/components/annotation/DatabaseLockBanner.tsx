/**
 * Database Lock Banner Component
 *
 * Displays the current lock status for the database.
 * Shows different states:
 * - Loading: Checking lock status
 * - Editing: User has the lock and can edit
 * - Read-only: Lock denied, shows who has it
 * - Processing: Server is processing (ML running)
 * - Syncing: Changes are being synced
 */

import { useEffect, useState } from 'react'

import type { LockState } from '~/services/database-lock'

// =============================================================================
// Types
// =============================================================================

export type LockDisplayState =
  | 'loading'
  | 'checking'
  | 'acquiring'
  | 'granted'
  | 'denied'
  | 'transferring'
  | 'server_processing'
  | 'released'
  | 'error'

export interface LockHolderInfo {
  userId: string
  displayName?: string
  isCurrentUser: boolean
}

export interface DatabaseLockBannerProps {
  lockState: LockDisplayState
  lockHolder: LockHolderInfo | null
  canEdit: boolean
  syncStatus?: {
    connected: boolean
    syncing: boolean
    pendingChanges: number
  }
  onRequestLock?: () => void
  onReleaseLock?: () => void
  className?: string
}

// =============================================================================
// Component
// =============================================================================

export function DatabaseLockBanner({
  lockState,
  lockHolder,
  canEdit,
  syncStatus,
  onRequestLock,
  onReleaseLock,
  className = '',
}: DatabaseLockBannerProps) {
  // Animated dots for loading states
  const [dots, setDots] = useState('')

  useEffect((): (() => void) | void => {
    if (lockState === 'loading' || lockState === 'checking' || lockState === 'acquiring') {
      const interval = setInterval(() => {
        setDots(d => (d.length >= 3 ? '' : d + '.'))
      }, 500)
      return () => clearInterval(interval)
    }
  }, [lockState])

  // Determine banner style based on state
  const getBannerStyle = () => {
    switch (lockState) {
      case 'granted':
        return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
      case 'denied':
        return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
      case 'server_processing':
        return 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
      case 'error':
        return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
      default:
        return 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
    }
  }

  // Get icon based on state
  const getIcon = (): React.ReactNode => {
    switch (lockState) {
      case 'loading':
      case 'checking':
      case 'acquiring':
        return (
          <svg className="h-5 w-5 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
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
        )
      case 'granted':
        return (
          <svg
            className="h-5 w-5 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        )
      case 'denied':
        return (
          <svg
            className="h-5 w-5 text-yellow-500"
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
        )
      case 'server_processing':
        return (
          <svg
            className="h-5 w-5 text-blue-500 animate-pulse"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        )
      case 'error':
        return (
          <svg
            className="h-5 w-5 text-red-500"
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
        )
      default:
        return (
          <svg
            className="h-5 w-5 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )
    }
  }

  // Get message based on state
  const getMessage = () => {
    switch (lockState) {
      case 'loading':
        return `Loading database${dots}`
      case 'checking':
        return `Checking lock status${dots}`
      case 'acquiring':
        return `Acquiring edit lock${dots}`
      case 'granted':
        return 'Editing enabled'
      case 'denied':
        if (lockHolder) {
          const holderName = lockHolder.displayName || lockHolder.userId
          return `Read-only: ${holderName} is currently editing`
        }
        return 'Read-only: Another user is editing'
      case 'transferring':
        return 'Transferring session...'
      case 'server_processing':
        return 'Read-only: Server is processing ML predictions'
      case 'released':
        return 'View only mode'
      case 'error':
        return 'Error loading database'
      default:
        return 'Unknown state'
    }
  }

  // Get secondary message (sync status)
  const getSecondaryMessage = () => {
    if (!syncStatus) return null

    if (!syncStatus.connected) {
      return (
        <span className="text-yellow-600 dark:text-yellow-400">
          Offline - changes will sync when connected
        </span>
      )
    }

    if (syncStatus.syncing) {
      return <span className="text-blue-600 dark:text-blue-400">Syncing changes...</span>
    }

    if (syncStatus.pendingChanges > 0) {
      return (
        <span className="text-blue-600 dark:text-blue-400">
          {syncStatus.pendingChanges} pending change{syncStatus.pendingChanges === 1 ? '' : 's'}
        </span>
      )
    }

    if (lockState === 'granted') {
      return <span className="text-green-600 dark:text-green-400">All changes saved</span>
    }

    return null
  }

  // Render action button if applicable
  const renderActionButton = () => {
    if (lockState === 'denied' && onRequestLock) {
      return (
        <button
          onClick={onRequestLock}
          className="ml-4 rounded bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-800 dark:text-yellow-100 dark:hover:bg-yellow-700"
        >
          Request Lock
        </button>
      )
    }

    if (lockState === 'granted' && onReleaseLock) {
      return (
        <button
          onClick={onReleaseLock}
          className="ml-4 rounded bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          Release Lock
        </button>
      )
    }

    return null
  }

  const secondaryMessage = getSecondaryMessage()

  return (
    <div className={`rounded-lg border px-4 py-2 ${getBannerStyle()} ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {getIcon()}
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {getMessage()}
            </span>
            {secondaryMessage && <span className="ml-2 text-xs">{secondaryMessage}</span>}
          </div>
        </div>
        {renderActionButton()}
      </div>
    </div>
  )
}

// =============================================================================
// Compact Variant
// =============================================================================

export interface DatabaseLockBadgeProps {
  lockState: LockDisplayState
  canEdit: boolean
  syncStatus?: {
    connected: boolean
    syncing: boolean
    pendingChanges: number
  }
}

/**
 * Compact badge version for use in headers/toolbars.
 */
export function DatabaseLockBadge({ lockState, canEdit, syncStatus }: DatabaseLockBadgeProps) {
  const getBadgeStyle = () => {
    if (!syncStatus?.connected) {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100'
    }

    switch (lockState) {
      case 'granted':
        return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
      case 'denied':
      case 'server_processing':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
      default:
        return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
    }
  }

  const getLabel = () => {
    if (!syncStatus?.connected) {
      return 'Offline'
    }

    if (syncStatus?.syncing) {
      return 'Syncing...'
    }

    switch (lockState) {
      case 'loading':
      case 'checking':
      case 'acquiring':
        return 'Loading...'
      case 'granted':
        return 'Editing'
      case 'denied':
      case 'server_processing':
        return 'Read-only'
      case 'error':
        return 'Error'
      default:
        return 'View only'
    }
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getBadgeStyle()}`}
    >
      {lockState === 'loading' ||
      lockState === 'checking' ||
      lockState === 'acquiring' ||
      syncStatus?.syncing ? (
        <svg className="-ml-0.5 mr-1 h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
      ) : null}
      {getLabel()}
    </span>
  )
}
