/**
 * useLayoutDatabase Hook
 *
 * React hook for layout database operations using CR-SQLite.
 * Replaces the REST API calls from layout-api.ts with local database queries.
 *
 * This hook provides:
 * - Database initialization with lock management
 * - Methods matching the current layout-api.ts interface
 * - Loading states and error handling
 * - Automatic sync via WebSocket
 * - Lock status tracking
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

import { DATABASE_NAMES } from '~/config'
import type { DatabaseError } from '~/services/database-errors'
import type { DownloadProgress } from '~/services/database-loader'
import type { LockStatus, LockState } from '~/services/database-lock'
import type {
  LayoutQueueResult,
  BoxDataResult,
  FrameBoxesResult,
} from '~/services/database-queries'
import {
  LayoutSyncService,
  getLayoutSyncService,
  removeLayoutSyncService,
  type LayoutSyncEvent,
} from '~/services/layout-sync-service'
import {
  useDatabaseInstance,
  useLockStatus,
  useSyncStatus,
  useDatabaseError,
  useDownloadProgress,
} from '~/stores/database-store'
import type { BoxLabel } from '~/types/enums'

// =============================================================================
// Types
// =============================================================================

/**
 * Lock state type (extended for UI).
 */
export type LayoutLockState = LockState | 'loading'

/**
 * Layout database hook parameters.
 */
export interface UseLayoutDatabaseParams {
  /** Video ID to load */
  videoId: string
  /** Tenant ID (for S3 path) - can be fetched from video metadata */
  tenantId?: string
  /** Whether to automatically acquire lock on init */
  autoAcquireLock?: boolean
  /** Callback for errors */
  onError?: (error: Error) => void
}

/**
 * Layout database hook return type.
 */
export interface UseLayoutDatabaseReturn {
  // State
  /** Whether the database is initialized and ready */
  isReady: boolean
  /** Whether the database is currently loading */
  isLoading: boolean
  /** Whether we have the editing lock */
  canEdit: boolean
  /** Current lock state */
  lockState: LayoutLockState
  /** Lock holder info (if denied) */
  lockHolder: LockStatus['holder'] | null
  /** Download progress */
  downloadProgress: DownloadProgress | null
  /** Current error */
  error: Error | DatabaseError | null
  /** Sync status */
  syncStatus: {
    connected: boolean
    syncing: boolean
    pendingChanges: number
  }

  // API Methods (matching layout-api.ts)
  /** Fetch layout queue data */
  getQueue: () => Promise<LayoutQueueResult>
  /** Fetch analysis boxes */
  getAnalysisBoxes: () => Promise<{ boxes: BoxDataResult[] }>
  /** Fetch boxes for a frame */
  getFrameBoxes: (frameIndex: number) => Promise<FrameBoxesResult>
  /** Save box annotations */
  saveAnnotations: (
    frameIndex: number,
    annotations: Array<{ boxIndex: number; label: BoxLabel }>
  ) => Promise<void>
  /** Recalculate predictions (server-side) */
  recalculatePredictions: () => Promise<void>
  /** Reset crop region (server-side) */
  resetCropRegion: () => Promise<{ success: boolean; message?: string }>
  /** Clear all annotations */
  clearAllAnnotations: () => Promise<{ deletedCount: number }>
  /** Bulk annotate by rectangle */
  bulkAnnotateAll: (
    rectangle: { left: number; top: number; right: number; bottom: number },
    action: 'clear' | 'mark_out'
  ) => Promise<{ newlyAnnotatedBoxes?: number; error?: string }>
  /** Approve layout */
  approveLayout: () => Promise<void>
  /** Prefetch frame boxes (for performance) */
  prefetchFrameBoxes: (
    frames: Array<{ frameIndex: number }>,
    cache: Map<number, FrameBoxesResult>
  ) => Promise<void>

  // Lock Management
  /** Acquire the editing lock */
  acquireLock: () => Promise<LockStatus>
  /** Release the editing lock */
  releaseLock: () => Promise<void>
  /** Request lock transfer (from another tab) */
  requestTransfer: () => Promise<LockStatus>

  // Event Subscription
  /** Subscribe to database change events */
  onChanges: (callback: (event: LayoutSyncEvent) => void) => () => void

  // Cleanup
  /** Close database and release resources */
  close: () => Promise<void>
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for layout database operations.
 */
// eslint-disable-next-line max-lines-per-function -- Database hook with complete API surface; splitting would duplicate state management
export function useLayoutDatabase({
  videoId,
  tenantId: providedTenantId,
  autoAcquireLock = true,
  onError,
}: UseLayoutDatabaseParams): UseLayoutDatabaseReturn {
  // Get tenant ID - default to video ID if not provided
  // In production, this should be fetched from video metadata
  const tenantId = providedTenantId ?? videoId

  // Service reference
  const serviceRef = useRef<LayoutSyncService | null>(null)

  // Local state
  const [isLoading, setIsLoading] = useState(true)
  const [localError, setLocalError] = useState<Error | null>(null)

  // Database store state
  const instance = useDatabaseInstance(videoId, DATABASE_NAMES.LAYOUT)
  const lockStatus = useLockStatus(videoId, DATABASE_NAMES.LAYOUT)
  const syncStatus = useSyncStatus(videoId, DATABASE_NAMES.LAYOUT)
  const downloadProgress = useDownloadProgress(videoId, DATABASE_NAMES.LAYOUT)
  const storeError = useDatabaseError(videoId, DATABASE_NAMES.LAYOUT)

  // Combine errors
  const error = localError ?? storeError

  // Derived state
  const isReady = instance?.ready ?? false
  const canEdit = lockStatus?.canEdit ?? false
  const lockState: LayoutLockState = isLoading ? 'loading' : (lockStatus?.state ?? 'released')
  const lockHolder = lockStatus?.holder ?? null

  // Initialize database
  useEffect(() => {
    if (!videoId) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    const init = async () => {
      setIsLoading(true)
      setLocalError(null)

      try {
        const service = getLayoutSyncService(videoId, tenantId)
        serviceRef.current = service

        await service.initialize(autoAcquireLock)

        if (!cancelled) {
          setIsLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          const error = err as Error
          setLocalError(error)
          setIsLoading(false)
          onError?.(error)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [videoId, tenantId, autoAcquireLock, onError])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't close on unmount - let other components use the same service
      // The service will be cleaned up when explicitly closed or on page unload
    }
  }, [])

  // ===========================================================================
  // API Methods
  // ===========================================================================

  const getQueue = useCallback(async (): Promise<LayoutQueueResult> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.fetchLayoutQueue()
  }, [])

  const getAnalysisBoxes = useCallback(async (): Promise<{ boxes: BoxDataResult[] }> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.fetchAnalysisBoxes()
  }, [])

  const getFrameBoxes = useCallback(async (frameIndex: number): Promise<FrameBoxesResult> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.fetchFrameBoxes(frameIndex)
  }, [])

  const saveAnnotations = useCallback(
    async (
      frameIndex: number,
      annotations: Array<{ boxIndex: number; label: BoxLabel }>
    ): Promise<void> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.saveBoxAnnotations(frameIndex, annotations)
    },
    []
  )

  const recalculatePredictions = useCallback(async (): Promise<void> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.recalculatePredictions()
  }, [])

  const resetCropRegion = useCallback(async (): Promise<{ success: boolean; message?: string }> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.resetCropRegion()
  }, [])

  const clearAllAnnotations = useCallback(async (): Promise<{ deletedCount: number }> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.clearAllAnnotations()
  }, [])

  const bulkAnnotateAll = useCallback(
    async (
      rectangle: { left: number; top: number; right: number; bottom: number },
      action: 'clear' | 'mark_out'
    ): Promise<{ newlyAnnotatedBoxes?: number; error?: string }> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.bulkAnnotateAll(rectangle, action)
    },
    []
  )

  const approveLayout = useCallback(async (): Promise<void> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.approveLayout()
  }, [])

  const prefetchFrameBoxes = useCallback(
    async (
      frames: Array<{ frameIndex: number }>,
      cache: Map<number, FrameBoxesResult>
    ): Promise<void> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        return
      }

      console.log(`[useLayoutDatabase] Prefetching ${frames.length} frames`)

      const prefetchPromises = frames.map(async frame => {
        if (cache.has(frame.frameIndex)) {
          return
        }

        try {
          const data = await service.fetchFrameBoxes(frame.frameIndex)
          cache.set(frame.frameIndex, data)
        } catch (err) {
          console.warn(`[useLayoutDatabase] Failed to prefetch frame ${frame.frameIndex}:`, err)
        }
      })

      await Promise.all(prefetchPromises)
      console.log('[useLayoutDatabase] Prefetch complete')
    },
    []
  )

  // ===========================================================================
  // Lock Management
  // ===========================================================================

  const acquireLock = useCallback(async (): Promise<LockStatus> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.acquireLock()
  }, [])

  const releaseLock = useCallback(async (): Promise<void> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      return
    }
    return service.releaseLock()
  }, [])

  const requestTransfer = useCallback(async (): Promise<LockStatus> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    // Request transfer is the same as acquiring - server handles notification
    return service.acquireLock()
  }, [])

  // ===========================================================================
  // Event Subscription
  // ===========================================================================

  const onChanges = useCallback((callback: (event: LayoutSyncEvent) => void): (() => void) => {
    const service = serviceRef.current
    if (!service) {
      return () => {}
    }
    return service.addEventListener(callback)
  }, [])

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  const close = useCallback(async (): Promise<void> => {
    if (serviceRef.current) {
      await removeLayoutSyncService(videoId)
      serviceRef.current = null
    }
  }, [videoId])

  // ===========================================================================
  // Return
  // ===========================================================================

  return useMemo(
    () => ({
      // State
      isReady,
      isLoading,
      canEdit,
      lockState,
      lockHolder,
      downloadProgress,
      error,
      syncStatus: {
        connected: syncStatus.connected,
        syncing: syncStatus.syncing,
        pendingChanges: syncStatus.pendingChanges,
      },

      // API Methods
      getQueue,
      getAnalysisBoxes,
      getFrameBoxes,
      saveAnnotations,
      recalculatePredictions,
      resetCropRegion,
      clearAllAnnotations,
      bulkAnnotateAll,
      approveLayout,
      prefetchFrameBoxes,

      // Lock Management
      acquireLock,
      releaseLock,
      requestTransfer,

      // Event Subscription
      onChanges,

      // Cleanup
      close,
    }),
    [
      isReady,
      isLoading,
      canEdit,
      lockState,
      lockHolder,
      downloadProgress,
      error,
      syncStatus.connected,
      syncStatus.syncing,
      syncStatus.pendingChanges,
      getQueue,
      getAnalysisBoxes,
      getFrameBoxes,
      saveAnnotations,
      recalculatePredictions,
      resetCropRegion,
      clearAllAnnotations,
      bulkAnnotateAll,
      approveLayout,
      prefetchFrameBoxes,
      acquireLock,
      releaseLock,
      requestTransfer,
      onChanges,
      close,
    ]
  )
}

// =============================================================================
// Convenience Hooks
// =============================================================================

/**
 * Hook to just check if layout database can edit.
 */
export function useLayoutCanEdit(videoId: string): boolean {
  const lockStatus = useLockStatus(videoId, DATABASE_NAMES.LAYOUT)
  return lockStatus?.canEdit ?? false
}

/**
 * Hook to get layout lock state.
 */
export function useLayoutLockState(videoId: string): LayoutLockState {
  const lockStatus = useLockStatus(videoId, DATABASE_NAMES.LAYOUT)
  const instance = useDatabaseInstance(videoId, DATABASE_NAMES.LAYOUT)

  if (!instance?.ready) {
    return 'loading'
  }

  return lockStatus?.state ?? 'released'
}

/**
 * Hook to get layout sync status.
 */
export function useLayoutSyncStatus(videoId: string): {
  connected: boolean
  syncing: boolean
  pendingChanges: number
} {
  const syncStatus = useSyncStatus(videoId, DATABASE_NAMES.LAYOUT)
  return {
    connected: syncStatus.connected,
    syncing: syncStatus.syncing,
    pendingChanges: syncStatus.pendingChanges,
  }
}
