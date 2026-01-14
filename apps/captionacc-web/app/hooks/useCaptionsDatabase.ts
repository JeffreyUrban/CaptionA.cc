/**
 * useCaptionsDatabase Hook
 *
 * React hook for caption database operations using CR-SQLite.
 * Replaces the REST API calls from caption annotation hooks with local database queries.
 *
 * This hook provides:
 * - Database initialization with lock management
 * - Methods matching the current caption annotation API
 * - Loading states and error handling
 * - Automatic sync via WebSocket
 * - Lock status tracking
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

import { DATABASE_NAMES } from '~/config'
import {
  useDatabaseStore,
  useDatabaseInstance,
  useLockStatus,
  useSyncStatus,
  useDatabaseError,
  useDownloadProgress,
} from '~/stores/database-store'
import {
  CaptionSyncService,
  getCaptionSyncService,
  removeCaptionSyncService,
  type CaptionSyncEvent,
} from '~/services/caption-sync-service'
import type { LockStatus, LockState } from '~/services/database-lock'
import type { DownloadProgress } from '~/services/database-loader'
import type { DatabaseError } from '~/services/database-errors'
import type {
  CaptionQueueResult,
  CaptionFrameExtentsQueueResult,
  CaptionAnnotationData,
  VideoPreferencesResult,
  CaptionFrameExtentState,
  TextStatus,
} from '~/services/database-queries'

// =============================================================================
// Types
// =============================================================================

/**
 * Lock state type (extended for UI).
 */
export type CaptionLockState = LockState | 'loading'

/**
 * Caption database hook parameters.
 */
export interface UseCaptionsDatabaseParams {
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
 * Caption database hook return type.
 */
export interface UseCaptionsDatabaseReturn {
  // State
  /** Whether the database is initialized and ready */
  isReady: boolean
  /** Whether the database is currently loading */
  isLoading: boolean
  /** Whether we have the editing lock */
  canEdit: boolean
  /** Current lock state */
  lockState: CaptionLockState
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

  // Text Annotation API
  /** Get text annotation queue */
  getQueue: () => Promise<CaptionQueueResult>
  /** Get a single annotation by ID */
  getAnnotation: (annotationId: number) => Promise<CaptionAnnotationData | null>
  /** Update annotation text, status, and notes */
  updateAnnotationText: (
    annotationId: number,
    text: string,
    textStatus: TextStatus,
    textNotes: string
  ) => Promise<void>
  /** Get text workflow progress */
  getTextProgress: () => Promise<{
    total: number
    completed: number
    pending: number
    progress: number
  }>

  // Caption Frame Extents API
  /** Get frame extents queue */
  getFrameExtentsQueue: (options?: {
    startFrame?: number
    endFrame?: number
    workable?: boolean
    limit?: number
  }) => Promise<CaptionFrameExtentsQueueResult>
  /** Get annotations for a frame range */
  getAnnotationsForRange: (startFrame: number, endFrame: number) => Promise<CaptionAnnotationData[]>
  /** Update frame extents and state */
  updateFrameExtents: (
    annotationId: number,
    startFrameIndex: number,
    endFrameIndex: number,
    state: CaptionFrameExtentState
  ) => Promise<{ createdGaps: CaptionAnnotationData[] }>
  /** Create a new annotation */
  createAnnotation: (
    startFrameIndex: number,
    endFrameIndex: number,
    state?: CaptionFrameExtentState
  ) => Promise<void>
  /** Delete an annotation */
  deleteAnnotation: (annotationId: number) => Promise<void>
  /** Get frame extents workflow progress */
  getFrameExtentsProgress: () => Promise<{
    total: number
    completed: number
    pending: number
    progress: number
  }>

  // Preferences API
  /** Get video preferences */
  getPreferences: () => Promise<VideoPreferencesResult>
  /** Update video preferences */
  updatePreferences: (preferences: Partial<VideoPreferencesResult>) => Promise<void>

  // Lock Management
  /** Acquire the editing lock */
  acquireLock: () => Promise<LockStatus>
  /** Release the editing lock */
  releaseLock: () => Promise<void>
  /** Request lock transfer (from another tab) */
  requestTransfer: () => Promise<LockStatus>

  // Event Subscription
  /** Subscribe to database change events */
  onChanges: (callback: (event: CaptionSyncEvent) => void) => () => void

  // Cleanup
  /** Close database and release resources */
  close: () => Promise<void>
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for caption database operations.
 */
export function useCaptionsDatabase({
  videoId,
  tenantId: providedTenantId,
  autoAcquireLock = true,
  onError,
}: UseCaptionsDatabaseParams): UseCaptionsDatabaseReturn {
  // Get tenant ID - default to video ID if not provided
  // In production, this should be fetched from video metadata
  const tenantId = providedTenantId ?? videoId

  // Service reference
  const serviceRef = useRef<CaptionSyncService | null>(null)

  // Local state
  const [isLoading, setIsLoading] = useState(true)
  const [localError, setLocalError] = useState<Error | null>(null)

  // Database store state
  const instance = useDatabaseInstance(videoId, DATABASE_NAMES.CAPTIONS)
  const lockStatus = useLockStatus(videoId, DATABASE_NAMES.CAPTIONS)
  const syncStatus = useSyncStatus(videoId, DATABASE_NAMES.CAPTIONS)
  const downloadProgress = useDownloadProgress(videoId, DATABASE_NAMES.CAPTIONS)
  const storeError = useDatabaseError(videoId, DATABASE_NAMES.CAPTIONS)

  // Combine errors
  const error = localError ?? storeError

  // Derived state
  const isReady = instance?.ready ?? false
  const canEdit = lockStatus?.canEdit ?? false
  const lockState: CaptionLockState = isLoading ? 'loading' : (lockStatus?.state ?? 'released')
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
        const service = getCaptionSyncService(videoId, tenantId)
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
  // Text Annotation API
  // ===========================================================================

  const getQueue = useCallback(async (): Promise<CaptionQueueResult> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.fetchTextAnnotationQueue()
  }, [])

  const getAnnotation = useCallback(
    async (annotationId: number): Promise<CaptionAnnotationData | null> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.fetchAnnotation(annotationId)
    },
    []
  )

  const updateAnnotationText = useCallback(
    async (
      annotationId: number,
      text: string,
      textStatus: TextStatus,
      textNotes: string
    ): Promise<void> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.saveTextAnnotation(annotationId, text, textStatus, textNotes)
    },
    []
  )

  const getTextProgress = useCallback(async (): Promise<{
    total: number
    completed: number
    pending: number
    progress: number
  }> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.getTextWorkflowProgress()
  }, [])

  // ===========================================================================
  // Caption Frame Extents API
  // ===========================================================================

  const getFrameExtentsQueue = useCallback(
    async (options?: {
      startFrame?: number
      endFrame?: number
      workable?: boolean
      limit?: number
    }): Promise<CaptionFrameExtentsQueueResult> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.fetchCaptionFrameExtentsQueue(options)
    },
    []
  )

  const getAnnotationsForRange = useCallback(
    async (startFrame: number, endFrame: number): Promise<CaptionAnnotationData[]> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.getAnnotationsForRange(startFrame, endFrame)
    },
    []
  )

  const updateFrameExtents = useCallback(
    async (
      annotationId: number,
      startFrameIndex: number,
      endFrameIndex: number,
      state: CaptionFrameExtentState
    ): Promise<{ createdGaps: CaptionAnnotationData[] }> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.saveFrameExtents(annotationId, startFrameIndex, endFrameIndex, state)
    },
    []
  )

  const createAnnotation = useCallback(
    async (
      startFrameIndex: number,
      endFrameIndex: number,
      state: CaptionFrameExtentState = 'gap'
    ): Promise<void> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.createAnnotation(startFrameIndex, endFrameIndex, state)
    },
    []
  )

  const deleteAnnotation = useCallback(async (annotationId: number): Promise<void> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.deleteAnnotation(annotationId)
  }, [])

  const getFrameExtentsProgress = useCallback(async (): Promise<{
    total: number
    completed: number
    pending: number
    progress: number
  }> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.getFrameExtentsWorkflowProgress()
  }, [])

  // ===========================================================================
  // Preferences API
  // ===========================================================================

  const getPreferences = useCallback(async (): Promise<VideoPreferencesResult> => {
    const service = serviceRef.current
    if (!service?.isReady) {
      throw new Error('Database not ready')
    }
    return service.getPreferences()
  }, [])

  const updatePreferences = useCallback(
    async (preferences: Partial<VideoPreferencesResult>): Promise<void> => {
      const service = serviceRef.current
      if (!service?.isReady) {
        throw new Error('Database not ready')
      }
      return service.updatePreferences(preferences)
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

  const onChanges = useCallback((callback: (event: CaptionSyncEvent) => void): (() => void) => {
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
      await removeCaptionSyncService(videoId)
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

      // Text Annotation API
      getQueue,
      getAnnotation,
      updateAnnotationText,
      getTextProgress,

      // Caption Frame Extents API
      getFrameExtentsQueue,
      getAnnotationsForRange,
      updateFrameExtents,
      createAnnotation,
      deleteAnnotation,
      getFrameExtentsProgress,

      // Preferences API
      getPreferences,
      updatePreferences,

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
      getAnnotation,
      updateAnnotationText,
      getTextProgress,
      getFrameExtentsQueue,
      getAnnotationsForRange,
      updateFrameExtents,
      createAnnotation,
      deleteAnnotation,
      getFrameExtentsProgress,
      getPreferences,
      updatePreferences,
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
 * Hook to just check if caption database can edit.
 */
export function useCaptionCanEdit(videoId: string): boolean {
  const lockStatus = useLockStatus(videoId, DATABASE_NAMES.CAPTIONS)
  return lockStatus?.canEdit ?? false
}

/**
 * Hook to get caption lock state.
 */
export function useCaptionLockState(videoId: string): CaptionLockState {
  const lockStatus = useLockStatus(videoId, DATABASE_NAMES.CAPTIONS)
  const instance = useDatabaseInstance(videoId, DATABASE_NAMES.CAPTIONS)

  if (!instance?.ready) {
    return 'loading'
  }

  return lockStatus?.state ?? 'released'
}

/**
 * Hook to get caption sync status.
 */
export function useCaptionSyncStatus(videoId: string): {
  connected: boolean
  syncing: boolean
  pendingChanges: number
} {
  const syncStatus = useSyncStatus(videoId, DATABASE_NAMES.CAPTIONS)
  return {
    connected: syncStatus.connected,
    syncing: syncStatus.syncing,
    pendingChanges: syncStatus.pendingChanges,
  }
}
