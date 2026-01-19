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

import { CRSQLiteDatabase } from './crsqlite-client'
import { type LockStatus } from './database-lock'
import {
  getLayoutQueue,
  getAllAnalysisBoxes,
  getFrameBoxes,
  updateBoxLabels,
  clearAllAnnotations as clearAnnotationsQuery,
  bulkAnnotateByRectangle,
  getAnnotationCount,
  setLayoutApproved,
  updateLayoutParams,
  applyPredictions as applyPredictionsQuery,
  type LayoutQueueResult,
  type BoxDataResult,
  type FrameBoxesResult,
  type LayoutConfigResult,
  type LayoutParamsUpdate,
  type BoxPredictionUpdate,
} from './database-queries'
import { subscribeToTable, type SubscriptionResult } from './database-subscriptions'

import { DATABASE_NAMES, type DatabaseName } from '~/config'
import { useDatabaseStore } from '~/stores/database-store'
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
    // Check if already initialized AND healthy
    if (this.initialized && this.database !== null && !this.error) {
      console.log(`[LayoutSync] Already initialized for ${this.videoId}`)
      return
    }

    // If initialized but broken (no database or has error), reset and re-initialize
    if (this.initialized && (this.database === null || this.error)) {
      console.log(`[LayoutSync] Resetting broken initialization for ${this.videoId}`)
      this.initialized = false
      this.initializing = false
      this.error = null
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
      console.log(`[LayoutSync] Starting initialization for ${this.videoId}`)
      // Use the database store to initialize
      const store = useDatabaseStore.getState()
      console.log(`[LayoutSync] Calling store.initializeDatabase...`)
      this.database = await store.initializeDatabase(this.tenantId, this.videoId, this.dbName, {
        acquireLock,
      })
      console.log(`[LayoutSync] Database initialized successfully`)

      // Get lock status
      const instance = store.instances[`${this.videoId}:${this.dbName}`]
      if (instance) {
        this.lockStatus = instance.lockStatus
        console.log(`[LayoutSync] Lock status:`, this.lockStatus)
      }

      // Set up subscriptions for UI updates
      console.log(`[LayoutSync] Setting up subscriptions...`)
      this.setupSubscriptions()

      this.initialized = true
      this.emitEvent({ type: 'initialized', videoId: this.videoId })

      console.log(`[LayoutSync] ✓ Initialized for ${this.videoId}`)
    } catch (err) {
      console.error(`[LayoutSync] ✗ Initialization failed for ${this.videoId}:`, err)
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
      canEdit: this.canEdit, // Uses getter which is temporarily always true
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
   * TODO: Re-enable lock-based check once lock server is working
   */
  get canEdit(): boolean {
    // TODO: Re-enable lock checking once lock acquisition is fixed
    // return this.lockStatus?.canEdit ?? false
    return true // Temporarily allow all edits
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
    const db = this.ensureReady()
    return getLayoutQueue(db, this.videoId)
  }

  /**
   * Fetch analysis boxes for all frames.
   * Equivalent to fetchAnalysisBoxes() from layout-api.ts.
   */
  async fetchAnalysisBoxes(): Promise<{ boxes: BoxDataResult[] }> {
    const db = this.ensureReady()
    const boxes = await getAllAnalysisBoxes(db)
    return { boxes }
  }

  /**
   * Fetch boxes for a specific frame.
   * Equivalent to fetchFrameBoxes() from layout-api.ts.
   */
  async fetchFrameBoxes(frameIndex: number): Promise<FrameBoxesResult> {
    const db = this.ensureReady()
    const layoutConfig = await this.getLayoutConfig()
    return getFrameBoxes(db, this.videoId, frameIndex, layoutConfig)
  }

  /**
   * Save box annotations for a frame.
   * Equivalent to saveBoxAnnotations() from layout-api.ts.
   */
  async saveBoxAnnotations(
    frameIndex: number,
    annotations: Array<{ boxIndex: number; label: BoxLabel }>
  ): Promise<void> {
    const db = this.ensureReady()
    this.ensureCanEdit()

    await updateBoxLabels(db, frameIndex, annotations)
    this.emitEvent({ type: 'boxes_changed', videoId: this.videoId, data: { frameIndex } })
  }

  /**
   * Recalculate predictions using Bayesian model on server.
   * Calls the backend API and updates local database with results.
   */
  async recalculatePredictions(): Promise<void> {
    const db = this.ensureReady()

    console.log(`[LayoutSync] Calling Bayesian analysis API for ${this.videoId}`)

    try {
      const response = await fetch(
        `/api/videos/${encodeURIComponent(this.videoId)}/actions/analyze-layout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          `Bayesian analysis failed: ${response.status} ${errorData.detail ?? response.statusText}`
        )
      }

      const result = await response.json()
      console.log(
        `[LayoutSync] Bayesian analysis complete: ${result.boxesAnalyzed} boxes analyzed in ${result.processingTimeMs}ms`
      )

      // Update local database with the returned layout parameters
      if (result.layoutParams) {
        const params: LayoutParamsUpdate = {
          verticalPosition: result.layoutParams.verticalPosition,
          verticalStd: result.layoutParams.verticalStd,
          boxHeight: result.layoutParams.boxHeight,
          boxHeightStd: result.layoutParams.boxHeightStd,
          anchorType: result.layoutParams.anchorType,
          anchorPosition: result.layoutParams.anchorPosition,
        }
        await updateLayoutParams(db, params)
        console.log('[LayoutSync] Local layout config updated with Bayesian results')

        // Emit config changed event so UI refreshes
        this.emitEvent({ type: 'config_changed', videoId: this.videoId, data: params })
      }
    } catch (error) {
      console.error('[LayoutSync] Bayesian analysis failed:', error)
      throw error
    }
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
    const db = this.ensureReady()
    this.ensureCanEdit()

    const deletedCount = await clearAnnotationsQuery(db)
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
    const db = this.ensureReady()
    this.ensureCanEdit()

    try {
      const newlyAnnotatedBoxes = await bulkAnnotateByRectangle(db, rectangle, action)
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
    const db = this.ensureReady()
    const { layoutConfig } = await getLayoutQueue(db, this.videoId)
    return layoutConfig
  }

  /**
   * Get annotation count.
   */
  async getAnnotationCount(): Promise<number> {
    const db = this.ensureReady()
    return getAnnotationCount(db)
  }

  /**
   * Set layout as approved.
   */
  async approveLayout(): Promise<void> {
    const db = this.ensureReady()
    this.ensureCanEdit()

    await setLayoutApproved(db, true)
    this.emitEvent({ type: 'config_changed', videoId: this.videoId })
  }

  /**
   * Apply predictions to boxes.
   * Updates predicted_label and predicted_confidence for each box.
   */
  async applyPredictions(predictions: BoxPredictionUpdate[]): Promise<number> {
    const db = this.ensureReady()

    console.log(`[LayoutSync] Applying ${predictions.length} predictions to local database`)
    const updated = await applyPredictionsQuery(db, predictions)
    console.log(`[LayoutSync] Applied predictions to ${updated} boxes`)

    // Emit boxes changed event so UI refreshes
    this.emitEvent({ type: 'boxes_changed', videoId: this.videoId })

    return updated
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
   * Returns the database instance if ready, throws otherwise.
   */
  private ensureReady(): CRSQLiteDatabase {
    if (!this.initialized || !this.database) {
      throw new Error('Layout sync service not initialized')
    }
    return this.database
  }

  /**
   * Ensure user can edit.
   * TODO: Re-enable lock checks once lock server is working
   */
  private ensureCanEdit(): void {
    // TODO: Re-enable lock checking once lock acquisition is fixed
    // if (!this.canEdit) {
    //   throw new Error('Cannot edit: lock not held')
    // }
    return // Temporarily allow all edits
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
