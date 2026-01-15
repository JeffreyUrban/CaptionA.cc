/**
 * Caption Sync Service
 *
 * Caption-specific database sync service extending the CR-SQLite infrastructure.
 * Handles captions.db initialization, sync, and provides high-level API
 * matching the current caption annotation hooks.
 *
 * Key responsibilities:
 * - Initialize captions.db for a video
 * - Manage lock acquisition/release
 * - Handle WebSocket sync lifecycle
 * - Emit events for UI updates
 * - Provide API compatible with existing caption annotation hooks
 */

import { DATABASE_NAMES, type DatabaseName } from '~/config'
import { useDatabaseStore, type DatabaseInstance } from '~/stores/database-store'
import { CRSQLiteDatabase } from './crsqlite-client'
import { type LockStatus, type LockState, type LockHolder } from './database-lock'
import {
  getTextAnnotationQueue,
  getCaptionFrameExtentsQueue,
  getCaptionAnnotation,
  getCaptionAnnotationsForRange,
  updateCaptionAnnotationText,
  updateCaptionFrameExtents,
  createCaptionAnnotation,
  deleteCaptionAnnotation,
  getVideoPreferences,
  updateVideoPreferences,
  getCaptionWorkflowProgress,
  getCaptionFrameExtentsWorkflowProgress,
  resolveFrameExtentOverlaps,
  type CaptionQueueResult,
  type CaptionFrameExtentsQueueResult,
  type CaptionAnnotationData,
  type VideoPreferencesResult,
  type CaptionFrameExtentState,
  type TextStatus,
} from './database-queries'
import { subscribeToTable, type SubscriptionResult } from './database-subscriptions'

// =============================================================================
// Types
// =============================================================================

/**
 * Caption sync service state.
 */
export interface CaptionSyncState {
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
 * Caption sync event types.
 */
export type CaptionSyncEventType =
  | 'initialized'
  | 'lock_changed'
  | 'annotations_changed'
  | 'preferences_changed'
  | 'error'
  | 'sync_complete'

/**
 * Caption sync event.
 */
export interface CaptionSyncEvent {
  type: CaptionSyncEventType
  videoId: string
  data?: unknown
}

/**
 * Caption sync event listener.
 */
export type CaptionSyncEventListener = (event: CaptionSyncEvent) => void

// =============================================================================
// Caption Sync Service
// =============================================================================

/**
 * Caption sync service for a single video.
 */
export class CaptionSyncService {
  readonly videoId: string
  readonly tenantId: string
  readonly dbName: DatabaseName = DATABASE_NAMES.CAPTIONS

  private initialized = false
  private initializing = false
  private database: CRSQLiteDatabase | null = null
  private lockStatus: LockStatus | null = null
  private error: Error | null = null
  private eventListeners = new Set<CaptionSyncEventListener>()
  private subscriptions: SubscriptionResult[] = []

  constructor(videoId: string, tenantId: string) {
    this.videoId = videoId
    this.tenantId = tenantId
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize the caption sync service.
   * Downloads database if needed and sets up sync.
   */
  async initialize(acquireLock = true): Promise<void> {
    if (this.initialized) {
      console.log(`[CaptionSync] Already initialized for ${this.videoId}`)
      return
    }

    if (this.initializing) {
      console.log(`[CaptionSync] Already initializing for ${this.videoId}`)
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

      console.log(`[CaptionSync] Initialized for ${this.videoId}`)
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

    console.log(`[CaptionSync] Closed for ${this.videoId}`)
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  /**
   * Get current state.
   */
  getState(): CaptionSyncState {
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
  // Text Annotation API
  // ===========================================================================

  /**
   * Fetch text annotation queue.
   * Returns annotations needing text entry.
   */
  async fetchTextAnnotationQueue(): Promise<CaptionQueueResult> {
    this.ensureReady()
    return getTextAnnotationQueue(this.database!)
  }

  /**
   * Fetch a single annotation by ID.
   */
  async fetchAnnotation(annotationId: number): Promise<CaptionAnnotationData | null> {
    this.ensureReady()
    return getCaptionAnnotation(this.database!, annotationId)
  }

  /**
   * Save text annotation.
   */
  async saveTextAnnotation(
    annotationId: number,
    text: string,
    textStatus: TextStatus,
    textNotes: string
  ): Promise<void> {
    this.ensureReady()
    this.ensureCanEdit()

    await updateCaptionAnnotationText(this.database!, annotationId, text, textStatus, textNotes)
    this.emitEvent({ type: 'annotations_changed', videoId: this.videoId, data: { annotationId } })
  }

  /**
   * Get text workflow progress.
   */
  async getTextWorkflowProgress(): Promise<{
    total: number
    completed: number
    pending: number
    progress: number
  }> {
    this.ensureReady()
    return getCaptionWorkflowProgress(this.database!)
  }

  // ===========================================================================
  // Caption Frame Extents API
  // ===========================================================================

  /**
   * Fetch caption frame extents queue.
   * Returns annotations needing frame extent annotation.
   */
  async fetchCaptionFrameExtentsQueue(options?: {
    startFrame?: number
    endFrame?: number
    workable?: boolean
    limit?: number
  }): Promise<CaptionFrameExtentsQueueResult> {
    this.ensureReady()
    return getCaptionFrameExtentsQueue(this.database!, options)
  }

  /**
   * Get annotations for a frame range.
   */
  async getAnnotationsForRange(
    startFrame: number,
    endFrame: number
  ): Promise<CaptionAnnotationData[]> {
    this.ensureReady()
    return getCaptionAnnotationsForRange(this.database!, startFrame, endFrame)
  }

  /**
   * Save frame extent annotation.
   * Handles overlap resolution and gap creation.
   */
  async saveFrameExtents(
    annotationId: number,
    startFrameIndex: number,
    endFrameIndex: number,
    state: CaptionFrameExtentState
  ): Promise<{ createdGaps: CaptionAnnotationData[] }> {
    this.ensureReady()
    this.ensureCanEdit()

    // Resolve overlaps first (creates gaps for uncovered frames)
    const createdGaps = await resolveFrameExtentOverlaps(
      this.database!,
      annotationId,
      startFrameIndex,
      endFrameIndex
    )

    // Update the annotation
    await updateCaptionFrameExtents(
      this.database!,
      annotationId,
      startFrameIndex,
      endFrameIndex,
      state
    )

    this.emitEvent({
      type: 'annotations_changed',
      videoId: this.videoId,
      data: { annotationId, createdGaps },
    })

    return { createdGaps }
  }

  /**
   * Create a new annotation (for gap fill or split).
   */
  async createAnnotation(
    startFrameIndex: number,
    endFrameIndex: number,
    state: CaptionFrameExtentState = 'gap'
  ): Promise<void> {
    this.ensureReady()
    this.ensureCanEdit()

    await createCaptionAnnotation(this.database!, startFrameIndex, endFrameIndex, state)
    this.emitEvent({ type: 'annotations_changed', videoId: this.videoId })
  }

  /**
   * Delete an annotation.
   */
  async deleteAnnotation(annotationId: number): Promise<void> {
    this.ensureReady()
    this.ensureCanEdit()

    await deleteCaptionAnnotation(this.database!, annotationId)
    this.emitEvent({ type: 'annotations_changed', videoId: this.videoId, data: { annotationId } })
  }

  /**
   * Get frame extents workflow progress.
   */
  async getFrameExtentsWorkflowProgress(): Promise<{
    total: number
    completed: number
    pending: number
    progress: number
  }> {
    this.ensureReady()
    return getCaptionFrameExtentsWorkflowProgress(this.database!)
  }

  // ===========================================================================
  // Preferences API
  // ===========================================================================

  /**
   * Get video preferences.
   */
  async getPreferences(): Promise<VideoPreferencesResult> {
    this.ensureReady()
    return getVideoPreferences(this.database!)
  }

  /**
   * Update video preferences.
   */
  async updatePreferences(preferences: Partial<VideoPreferencesResult>): Promise<void> {
    this.ensureReady()
    // Preferences can be updated even without edit lock
    await updateVideoPreferences(this.database!, preferences)
    this.emitEvent({ type: 'preferences_changed', videoId: this.videoId, data: preferences })
  }

  // ===========================================================================
  // Event System
  // ===========================================================================

  /**
   * Add an event listener.
   */
  addEventListener(listener: CaptionSyncEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(listener: CaptionSyncEventListener): void {
    this.eventListeners.delete(listener)
  }

  /**
   * Emit an event to all listeners.
   */
  private emitEvent(event: CaptionSyncEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[CaptionSync] Event listener error:', err)
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
      throw new Error('Caption sync service not initialized')
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
    // Subscribe to annotation changes
    const annotationSubscription = subscribeToTable(
      this.videoId,
      this.dbName,
      'caption_frame_extents',
      () => {
        this.emitEvent({ type: 'annotations_changed', videoId: this.videoId })
      },
      { debounce: 100 }
    )
    this.subscriptions.push(annotationSubscription)

    // Subscribe to preferences changes
    const preferencesSubscription = subscribeToTable(
      this.videoId,
      this.dbName,
      'video_preferences',
      () => {
        this.emitEvent({ type: 'preferences_changed', videoId: this.videoId })
      },
      { debounce: 100 }
    )
    this.subscriptions.push(preferencesSubscription)
  }
}

// =============================================================================
// Service Registry
// =============================================================================

/** Active caption sync services by video ID */
const captionServices = new Map<string, CaptionSyncService>()

/**
 * Get or create a caption sync service for a video.
 */
export function getCaptionSyncService(videoId: string, tenantId: string): CaptionSyncService {
  let service = captionServices.get(videoId)
  if (!service) {
    service = new CaptionSyncService(videoId, tenantId)
    captionServices.set(videoId, service)
  }
  return service
}

/**
 * Remove a caption sync service.
 */
export async function removeCaptionSyncService(videoId: string): Promise<void> {
  const service = captionServices.get(videoId)
  if (service) {
    await service.close()
    captionServices.delete(videoId)
  }
}

/**
 * Get an existing caption sync service (without creating).
 */
export function getExistingCaptionSyncService(videoId: string): CaptionSyncService | undefined {
  return captionServices.get(videoId)
}

/**
 * Close all caption sync services.
 */
export async function closeAllCaptionSyncServices(): Promise<void> {
  const closePromises = Array.from(captionServices.values()).map(service => service.close())
  await Promise.all(closePromises)
  captionServices.clear()
}
