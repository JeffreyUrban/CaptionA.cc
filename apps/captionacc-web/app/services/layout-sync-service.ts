/**
 * Layout Sync Service
 *
 * Layout-specific database sync service extending the CR-SQLite infrastructure.
 * Handles layout.db initialization, sync, and provides high-level API
 * matching the current layout-api.ts functions.
 *
 * Key responsibilities:
 * - Initialize layout.db for a video
 * - Manage lock acquisition/release
 * - Handle WebSocket sync lifecycle
 * - Emit events for UI updates
 * - Provide API compatible with existing layout-api.ts
 */

import { DATABASE_NAMES, type DatabaseName } from '~/config'
import { useDatabaseStore, type DatabaseInstance } from '~/stores/database-store'
import { CRSQLiteDatabase } from './crsqlite-client'
import { type LockStatus, type LockState, type LockHolder } from './database-lock'
import {
  getLayoutQueue,
  getAllAnalysisBoxes,
  getFrameBoxes,
  updateBoxLabels,
  clearAllAnnotations as clearAnnotationsQuery,
  bulkAnnotateByRectangle,
  getAnnotationCount,
  setLayoutApproved,
  type LayoutQueueResult,
  type BoxDataResult,
  type FrameBoxesResult,
  type LayoutConfigResult,
} from './database-queries'
import { subscribeToTable, type SubscriptionResult } from './database-subscriptions'
import type { BoxLabel } from '~/types/enums'

// =============================================================================
// Types
// =============================================================================

/**
 * Layout sync service state.
 */
export interface LayoutSyncState {
  /** Video ID being synced */
  videoId: string
  /** Tenant ID for the video */
  tenantId: string
  /** Whether the service is initialized */
  initialized: boolean
  /** Whether the service is currently initializing */
  initializing: boolean
  /** Current lock status */
  lockStatus: LockStatus | null
  /** Whether the user can edit */
  canEdit: boolean
  /** Last error */
  error: Error | null
  /** Database instance */
  database: CRSQLiteDatabase | null
}

/**
 * Layout sync event types.
 */
export type LayoutSyncEventType =
  | 'initialized'
  | 'lock_changed'
  | 'boxes_changed'
  | 'config_changed'
  | 'error'
  | 'sync_complete'

/**
 * Layout sync event.
 */
export interface LayoutSyncEvent {
  type: LayoutSyncEventType
  videoId: string
  data?: unknown
}

/**
 * Layout sync event listener.
 */
export type LayoutSyncEventListener = (event: LayoutSyncEvent) => void

// =============================================================================
// Layout Sync Service
// =============================================================================

/**
 * Layout sync service for a single video.
 */
export class LayoutSyncService {
  readonly videoId: string
  readonly tenantId: string
  readonly dbName: DatabaseName = DATABASE_NAMES.LAYOUT

  private initialized = false
  private initializing = false
  private database: CRSQLiteDatabase | null = null
  private lockStatus: LockStatus | null = null
  private error: Error | null = null
  private eventListeners = new Set<LayoutSyncEventListener>()
  private subscriptions: SubscriptionResult[] = []

  constructor(videoId: string, tenantId: string) {
    this.videoId = videoId
    this.tenantId = tenantId
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize the layout sync service.
   * Downloads database if needed and sets up sync.
   */
  async initialize(acquireLock = true): Promise<void> {
    if (this.initialized) {
      console.log(`[LayoutSync] Already initialized for ${this.videoId}`)
      return
    }

    if (this.initializing) {
      console.log(`[LayoutSync] Already initializing for ${this.videoId}`)
      // Wait for initialization to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.initialized) {
            clearInterval(checkInterval)
            resolve()
          } else if (this.error) {
            clearInterval(checkInterval)
            reject(this.error)
          }
        }, 100)
      })
    }

    this.initializing = true
    this.error = null

    try {
      // Use the database store to initialize
      const store = useDatabaseStore.getState()
      this.database = await store.initializeDatabase(this.tenantId, this.videoId, this.dbName, {
        acquireLock,
      })

      // Get lock status
      const instance = store.instances[`${this.videoId}:${this.dbName}`]
      if (instance) {
        this.lockStatus = instance.lockStatus
      }

      // Set up subscriptions for UI updates
      this.setupSubscriptions()

      this.initialized = true
      this.emitEvent({ type: 'initialized', videoId: this.videoId })

      console.log(`[LayoutSync] Initialized for ${this.videoId}`)
    } catch (err) {
      this.error = err as Error
      this.emitEvent({ type: 'error', videoId: this.videoId, data: err })
      throw err
    } finally {
      this.initializing = false
    }
  }

  /**
   * Close the service and release resources.
   */
  async close(): Promise<void> {
    // Unsubscribe from all subscriptions
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe()
    }
    this.subscriptions = []

    // Close the database via store
    if (this.initialized) {
      const store = useDatabaseStore.getState()
      await store.closeDatabase(this.videoId, this.dbName)
    }

    this.initialized = false
    this.database = null
    this.lockStatus = null
    this.eventListeners.clear()

    console.log(`[LayoutSync] Closed for ${this.videoId}`)
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  /**
   * Get current state.
   */
  getState(): LayoutSyncState {
    return {
      videoId: this.videoId,
      tenantId: this.tenantId,
      initialized: this.initialized,
      initializing: this.initializing,
      lockStatus: this.lockStatus,
      canEdit: this.lockStatus?.canEdit ?? false,
      error: this.error,
      database: this.database,
    }
  }

  /**
   * Check if service is ready for queries.
   */
  get isReady(): boolean {
    return this.initialized && this.database !== null
  }

  /**
   * Check if user can edit.
   */
  get canEdit(): boolean {
    return this.lockStatus?.canEdit ?? false
  }

  /**
   * Get the database instance.
   */
  getDatabase(): CRSQLiteDatabase | null {
    return this.database
  }

  // ===========================================================================
  // Lock Management
  // ===========================================================================

  /**
   * Acquire the editing lock.
   */
  async acquireLock(): Promise<LockStatus> {
    const store = useDatabaseStore.getState()
    this.lockStatus = await store.acquireLock(this.videoId, this.dbName)
    this.emitEvent({ type: 'lock_changed', videoId: this.videoId, data: this.lockStatus })
    return this.lockStatus
  }

  /**
   * Release the editing lock.
   */
  async releaseLock(): Promise<void> {
    const store = useDatabaseStore.getState()
    await store.releaseLock(this.videoId, this.dbName)
    this.lockStatus = { state: 'released', canEdit: false }
    this.emitEvent({ type: 'lock_changed', videoId: this.videoId, data: this.lockStatus })
  }

  /**
   * Check lock status.
   */
  async checkLock(): Promise<LockStatus> {
    const store = useDatabaseStore.getState()
    this.lockStatus = await store.checkLock(this.videoId, this.dbName)
    return this.lockStatus
  }

  /**
   * Get current lock status.
   */
  getLockStatus(): LockStatus | null {
    return this.lockStatus
  }

  // ===========================================================================
  // Query API (Matching layout-api.ts)
  // ===========================================================================

  /**
   * Fetch layout queue data.
   * Equivalent to fetchLayoutQueue() from layout-api.ts.
   */
  async fetchLayoutQueue(): Promise<LayoutQueueResult> {
    this.ensureReady()
    return getLayoutQueue(this.database!, this.videoId)
  }

  /**
   * Fetch analysis boxes for all frames.
   * Equivalent to fetchAnalysisBoxes() from layout-api.ts.
   */
  async fetchAnalysisBoxes(): Promise<{ boxes: BoxDataResult[] }> {
    this.ensureReady()
    const boxes = await getAllAnalysisBoxes(this.database!)
    return { boxes }
  }

  /**
   * Fetch boxes for a specific frame.
   * Equivalent to fetchFrameBoxes() from layout-api.ts.
   */
  async fetchFrameBoxes(frameIndex: number): Promise<FrameBoxesResult> {
    this.ensureReady()
    const layoutConfig = await this.getLayoutConfig()
    return getFrameBoxes(this.database!, this.videoId, frameIndex, layoutConfig)
  }

  /**
   * Save box annotations for a frame.
   * Equivalent to saveBoxAnnotations() from layout-api.ts.
   */
  async saveBoxAnnotations(
    frameIndex: number,
    annotations: Array<{ boxIndex: number; label: BoxLabel }>
  ): Promise<void> {
    this.ensureReady()
    this.ensureCanEdit()

    await updateBoxLabels(this.database!, frameIndex, annotations)
    this.emitEvent({ type: 'boxes_changed', videoId: this.videoId, data: { frameIndex } })
  }

  /**
   * Recalculate predictions.
   * Note: This is now handled server-side via the sync process.
   * The local operation is a no-op, but changes will sync back from server.
   */
  async recalculatePredictions(): Promise<void> {
    // Predictions are recalculated server-side when annotations sync
    // This is now a no-op locally
    console.log('[LayoutSync] Predictions will be recalculated server-side on sync')
  }

  /**
   * Reset crop region.
   * Note: Crop region calculation is now server-side.
   */
  async resetCropRegion(): Promise<{ success: boolean; message?: string }> {
    // Crop region is calculated server-side and synced back
    // This is now a no-op locally
    console.log('[LayoutSync] Crop region will be recalculated server-side on sync')
    return { success: true }
  }

  /**
   * Clear all annotations.
   * Equivalent to clearAllAnnotations() from layout-api.ts.
   */
  async clearAllAnnotations(): Promise<{ deletedCount: number }> {
    this.ensureReady()
    this.ensureCanEdit()

    const deletedCount = await clearAnnotationsQuery(this.database!)
    this.emitEvent({ type: 'boxes_changed', videoId: this.videoId })
    return { deletedCount }
  }

  /**
   * Bulk annotate boxes across all frames.
   * Equivalent to bulkAnnotateAll() from layout-api.ts.
   */
  async bulkAnnotateAll(
    rectangle: { left: number; top: number; right: number; bottom: number },
    action: 'clear' | 'mark_out'
  ): Promise<{ newlyAnnotatedBoxes?: number; error?: string }> {
    this.ensureReady()
    this.ensureCanEdit()

    try {
      const newlyAnnotatedBoxes = await bulkAnnotateByRectangle(this.database!, rectangle, action)
      this.emitEvent({ type: 'boxes_changed', videoId: this.videoId })
      return { newlyAnnotatedBoxes }
    } catch (err) {
      return { error: (err as Error).message }
    }
  }

  /**
   * Get layout configuration.
   */
  async getLayoutConfig(): Promise<LayoutConfigResult | null> {
    this.ensureReady()
    const { layoutConfig } = await getLayoutQueue(this.database!, this.videoId)
    return layoutConfig
  }

  /**
   * Get annotation count.
   */
  async getAnnotationCount(): Promise<number> {
    this.ensureReady()
    return getAnnotationCount(this.database!)
  }

  /**
   * Set layout as approved.
   */
  async approveLayout(): Promise<void> {
    this.ensureReady()
    this.ensureCanEdit()

    await setLayoutApproved(this.database!, true)
    this.emitEvent({ type: 'config_changed', videoId: this.videoId })
  }

  // ===========================================================================
  // Event System
  // ===========================================================================

  /**
   * Add an event listener.
   */
  addEventListener(listener: LayoutSyncEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(listener: LayoutSyncEventListener): void {
    this.eventListeners.delete(listener)
  }

  /**
   * Emit an event to all listeners.
   */
  private emitEvent(event: LayoutSyncEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[LayoutSync] Event listener error:', err)
      }
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Ensure service is ready for operations.
   */
  private ensureReady(): void {
    if (!this.initialized || !this.database) {
      throw new Error('Layout sync service not initialized')
    }
  }

  /**
   * Ensure user can edit.
   */
  private ensureCanEdit(): void {
    if (!this.canEdit) {
      throw new Error('Cannot edit: lock not held')
    }
  }

  /**
   * Set up subscriptions for database changes.
   */
  private setupSubscriptions(): void {
    // Subscribe to box changes
    const boxSubscription = subscribeToTable(
      this.videoId,
      this.dbName,
      'layout_analysis_boxes',
      () => {
        this.emitEvent({ type: 'boxes_changed', videoId: this.videoId })
      },
      { debounce: 100 }
    )
    this.subscriptions.push(boxSubscription)

    // Subscribe to parameter changes
    const paramSubscription = subscribeToTable(
      this.videoId,
      this.dbName,
      'layout_analysis_parameters',
      () => {
        this.emitEvent({ type: 'config_changed', videoId: this.videoId })
      },
      { debounce: 100 }
    )
    this.subscriptions.push(paramSubscription)
  }
}

// =============================================================================
// Service Registry
// =============================================================================

/** Active layout sync services by video ID */
const layoutServices = new Map<string, LayoutSyncService>()

/**
 * Get or create a layout sync service for a video.
 */
export function getLayoutSyncService(videoId: string, tenantId: string): LayoutSyncService {
  let service = layoutServices.get(videoId)
  if (!service) {
    service = new LayoutSyncService(videoId, tenantId)
    layoutServices.set(videoId, service)
  }
  return service
}

/**
 * Remove a layout sync service.
 */
export async function removeLayoutSyncService(videoId: string): Promise<void> {
  const service = layoutServices.get(videoId)
  if (service) {
    await service.close()
    layoutServices.delete(videoId)
  }
}

/**
 * Get an existing layout sync service (without creating).
 */
export function getExistingLayoutSyncService(videoId: string): LayoutSyncService | undefined {
  return layoutServices.get(videoId)
}

/**
 * Close all layout sync services.
 */
export async function closeAllLayoutSyncServices(): Promise<void> {
  const closePromises = Array.from(layoutServices.values()).map(service => service.close())
  await Promise.all(closePromises)
  layoutServices.clear()
}
