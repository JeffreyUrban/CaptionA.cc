/**
 * Database Subscriptions
 *
 * Change notification system for CR-SQLite databases.
 * Enables React components to subscribe to database changes with optional filters.
 *
 * Usage:
 * - Subscribe to all changes for a database
 * - Subscribe to specific table changes
 * - Subscribe to specific row changes (by primary key)
 * - Automatically triggers React re-renders on relevant changes
 */

import type { DatabaseName } from '~/config'
import type { CRSQLiteChange } from './crsqlite-client'

// =============================================================================
// Types
// =============================================================================

/**
 * Subscription filter for targeting specific changes.
 */
export interface SubscriptionFilter {
  /** Filter by table name */
  table?: string
  /** Filter by primary key values (exact match) */
  pk?: unknown[]
  /** Filter by column name */
  column?: string
}

/**
 * Subscription callback function.
 */
export type SubscriptionCallback = (changes: CRSQLiteChange[]) => void

/**
 * Subscription entry with ID and filter.
 */
interface Subscription {
  id: string
  filter?: SubscriptionFilter
  callback: SubscriptionCallback
}

/**
 * Subscription options.
 */
export interface SubscribeOptions {
  /** Optional filter to limit which changes trigger the callback */
  filter?: SubscriptionFilter
  /** Whether to debounce the callback (ms) */
  debounce?: number
}

/**
 * Subscription result with unsubscribe function.
 */
export interface SubscriptionResult {
  /** Unique subscription ID */
  id: string
  /** Unsubscribe function - call to stop receiving notifications */
  unsubscribe: () => void
}

// =============================================================================
// Database Subscription Manager
// =============================================================================

/**
 * Manages subscriptions for a single database.
 */
class DatabaseSubscriptionManager {
  private subscriptions = new Map<string, Subscription>()
  private subscriptionCounter = 0
  private debouncedCallbacks = new Map<string, NodeJS.Timeout>()

  readonly videoId: string
  readonly dbName: DatabaseName
  readonly instanceId: string

  constructor(videoId: string, dbName: DatabaseName) {
    this.videoId = videoId
    this.dbName = dbName
    this.instanceId = `${videoId}:${dbName}`
  }

  /**
   * Subscribe to database changes.
   *
   * @param callback Function to call when changes occur
   * @param options Subscription options (filter, debounce)
   * @returns Subscription result with unsubscribe function
   */
  subscribe(
    callback: SubscriptionCallback,
    options?: SubscribeOptions
  ): SubscriptionResult {
    const id = this.generateSubscriptionId()

    // Wrap callback with debounce if requested
    const wrappedCallback = options?.debounce
      ? this.createDebouncedCallback(id, callback, options.debounce)
      : callback

    const subscription: Subscription = {
      id,
      filter: options?.filter,
      callback: wrappedCallback,
    }

    this.subscriptions.set(id, subscription)

    console.log(
      `[DatabaseSubscriptions] Subscribed to ${this.instanceId}: ${id}`,
      options?.filter || 'all changes'
    )

    return {
      id,
      unsubscribe: () => this.unsubscribe(id),
    }
  }

  /**
   * Unsubscribe from database changes.
   */
  unsubscribe(subscriptionId: string): void {
    // Clear any pending debounced callback
    const timeout = this.debouncedCallbacks.get(subscriptionId)
    if (timeout) {
      clearTimeout(timeout)
      this.debouncedCallbacks.delete(subscriptionId)
    }

    this.subscriptions.delete(subscriptionId)
    console.log(`[DatabaseSubscriptions] Unsubscribed: ${subscriptionId}`)
  }

  /**
   * Notify all subscribers about changes.
   */
  notify(changes: CRSQLiteChange[]): void {
    if (changes.length === 0) {
      return
    }

    for (const subscription of this.subscriptions.values()) {
      // Filter changes for this subscription
      const relevantChanges = subscription.filter
        ? this.filterChanges(changes, subscription.filter)
        : changes

      if (relevantChanges.length > 0) {
        try {
          subscription.callback(relevantChanges)
        } catch (error) {
          console.error(
            `[DatabaseSubscriptions] Callback error for ${subscription.id}:`,
            error
          )
        }
      }
    }
  }

  /**
   * Clear all subscriptions.
   */
  clear(): void {
    // Clear all debounced callbacks
    for (const timeout of this.debouncedCallbacks.values()) {
      clearTimeout(timeout)
    }
    this.debouncedCallbacks.clear()
    this.subscriptions.clear()
  }

  /**
   * Get the number of active subscriptions.
   */
  get size(): number {
    return this.subscriptions.size
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate a unique subscription ID.
   */
  private generateSubscriptionId(): string {
    return `sub_${this.instanceId}_${++this.subscriptionCounter}_${Date.now()}`
  }

  /**
   * Create a debounced callback.
   */
  private createDebouncedCallback(
    subscriptionId: string,
    callback: SubscriptionCallback,
    delay: number
  ): SubscriptionCallback {
    let pendingChanges: CRSQLiteChange[] = []

    return (changes: CRSQLiteChange[]) => {
      pendingChanges.push(...changes)

      // Clear existing timeout
      const existingTimeout = this.debouncedCallbacks.get(subscriptionId)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }

      // Set new timeout
      const timeout = setTimeout(() => {
        this.debouncedCallbacks.delete(subscriptionId)
        const changesToNotify = [...pendingChanges]
        pendingChanges = []
        callback(changesToNotify)
      }, delay)

      this.debouncedCallbacks.set(subscriptionId, timeout)
    }
  }

  /**
   * Filter changes based on subscription filter.
   */
  private filterChanges(
    changes: CRSQLiteChange[],
    filter: SubscriptionFilter
  ): CRSQLiteChange[] {
    return changes.filter(change => {
      // Filter by table
      if (filter.table && change.table !== filter.table) {
        return false
      }

      // Filter by primary key
      if (filter.pk) {
        const changePk = change.pk
        if (!this.pkMatches(changePk, filter.pk)) {
          return false
        }
      }

      // Filter by column
      if (filter.column && change.cid !== filter.column) {
        return false
      }

      return true
    })
  }

  /**
   * Check if primary keys match.
   */
  private pkMatches(changePk: unknown[], filterPk: unknown[]): boolean {
    if (changePk.length !== filterPk.length) {
      return false
    }

    for (let i = 0; i < changePk.length; i++) {
      if (changePk[i] !== filterPk[i]) {
        return false
      }
    }

    return true
  }
}

// =============================================================================
// Global Subscription Registry
// =============================================================================

/** Subscription managers by instance ID */
const subscriptionManagers = new Map<string, DatabaseSubscriptionManager>()

/**
 * Get or create a subscription manager for a database.
 */
function getSubscriptionManager(
  videoId: string,
  dbName: DatabaseName
): DatabaseSubscriptionManager {
  const instanceId = `${videoId}:${dbName}`

  let manager = subscriptionManagers.get(instanceId)
  if (!manager) {
    manager = new DatabaseSubscriptionManager(videoId, dbName)
    subscriptionManagers.set(instanceId, manager)
  }

  return manager
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Subscribe to database changes.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @param callback Function to call when changes occur
 * @param options Subscription options
 * @returns Subscription result with unsubscribe function
 *
 * @example
 * // Subscribe to all changes
 * const { unsubscribe } = subscribeToChanges('video-1', 'layout', (changes) => {
 *   console.log('Changes:', changes)
 * })
 *
 * @example
 * // Subscribe to specific table
 * const { unsubscribe } = subscribeToChanges('video-1', 'layout', (changes) => {
 *   console.log('Layout boxes changed:', changes)
 * }, { filter: { table: 'layout_analysis_boxes' } })
 *
 * @example
 * // Subscribe with debounce
 * const { unsubscribe } = subscribeToChanges('video-1', 'captions', (changes) => {
 *   console.log('Caption changes:', changes)
 * }, { debounce: 100 })
 */
export function subscribeToChanges(
  videoId: string,
  dbName: DatabaseName,
  callback: SubscriptionCallback,
  options?: SubscribeOptions
): SubscriptionResult {
  const manager = getSubscriptionManager(videoId, dbName)
  return manager.subscribe(callback, options)
}

/**
 * Subscribe to changes for a specific table.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @param table Table name
 * @param callback Function to call when changes occur
 * @param options Additional subscription options
 * @returns Subscription result with unsubscribe function
 */
export function subscribeToTable(
  videoId: string,
  dbName: DatabaseName,
  table: string,
  callback: SubscriptionCallback,
  options?: Omit<SubscribeOptions, 'filter'>
): SubscriptionResult {
  return subscribeToChanges(videoId, dbName, callback, {
    ...options,
    filter: { table },
  })
}

/**
 * Subscribe to changes for a specific row.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @param table Table name
 * @param pk Primary key values
 * @param callback Function to call when changes occur
 * @param options Additional subscription options
 * @returns Subscription result with unsubscribe function
 */
export function subscribeToRow(
  videoId: string,
  dbName: DatabaseName,
  table: string,
  pk: unknown[],
  callback: SubscriptionCallback,
  options?: Omit<SubscribeOptions, 'filter'>
): SubscriptionResult {
  return subscribeToChanges(videoId, dbName, callback, {
    ...options,
    filter: { table, pk },
  })
}

/**
 * Notify subscribers about database changes.
 * Called by the sync manager when changes are received.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @param changes Changes to notify about
 */
export function notifySubscribers(
  videoId: string,
  dbName: DatabaseName,
  changes: CRSQLiteChange[]
): void {
  const instanceId = `${videoId}:${dbName}`
  const manager = subscriptionManagers.get(instanceId)

  if (manager) {
    manager.notify(changes)
  }
}

/**
 * Clear all subscriptions for a database.
 *
 * @param videoId Video ID
 * @param dbName Database name
 */
export function clearSubscriptions(videoId: string, dbName: DatabaseName): void {
  const instanceId = `${videoId}:${dbName}`
  const manager = subscriptionManagers.get(instanceId)

  if (manager) {
    manager.clear()
    subscriptionManagers.delete(instanceId)
  }
}

/**
 * Clear all subscriptions across all databases.
 */
export function clearAllSubscriptions(): void {
  for (const manager of subscriptionManagers.values()) {
    manager.clear()
  }
  subscriptionManagers.clear()
}

/**
 * Get the number of active subscriptions for a database.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @returns Number of active subscriptions
 */
export function getSubscriptionCount(
  videoId: string,
  dbName: DatabaseName
): number {
  const instanceId = `${videoId}:${dbName}`
  const manager = subscriptionManagers.get(instanceId)
  return manager?.size ?? 0
}

// =============================================================================
// React Integration Helpers
// =============================================================================

/**
 * Create a subscription that triggers a React state update.
 * Useful for creating reactive data hooks.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @param setState React setState function
 * @param transform Function to transform changes into new state
 * @param options Subscription options
 * @returns Unsubscribe function
 *
 * @example
 * function useLayoutBoxes(videoId: string) {
 *   const [boxes, setBoxes] = useState<Box[]>([])
 *
 *   useEffect(() => {
 *     // Initial fetch...
 *
 *     // Subscribe to changes
 *     return createReactSubscription(
 *       videoId,
 *       'layout',
 *       setBoxes,
 *       async (changes, currentState) => {
 *         // Refetch boxes when layout_analysis_boxes changes
 *         return await fetchBoxes(videoId)
 *       },
 *       { filter: { table: 'layout_analysis_boxes' } }
 *     )
 *   }, [videoId])
 *
 *   return boxes
 * }
 */
export function createReactSubscription<T>(
  videoId: string,
  dbName: DatabaseName,
  setState: React.Dispatch<React.SetStateAction<T>>,
  transform: (changes: CRSQLiteChange[], currentState: T) => T | Promise<T>,
  options?: SubscribeOptions
): () => void {
  const { unsubscribe } = subscribeToChanges(
    videoId,
    dbName,
    async (changes) => {
      setState(currentState => {
        const result = transform(changes, currentState)

        // Handle both sync and async transforms
        if (result instanceof Promise) {
          result.then(newState => setState(newState))
          return currentState // Return current while async completes
        }

        return result
      })
    },
    {
      ...options,
      // Default debounce for React updates
      debounce: options?.debounce ?? 16,
    }
  )

  return unsubscribe
}

/**
 * Create a simple refresh subscription.
 * Calls a refresh function when any matching changes occur.
 *
 * @param videoId Video ID
 * @param dbName Database name
 * @param refresh Function to call on changes
 * @param options Subscription options
 * @returns Unsubscribe function
 *
 * @example
 * function useAnnotations(videoId: string) {
 *   const [data, setData] = useState(null)
 *
 *   const refresh = useCallback(async () => {
 *     setData(await fetchAnnotations(videoId))
 *   }, [videoId])
 *
 *   useEffect(() => {
 *     refresh()
 *     return createRefreshSubscription(videoId, 'captions', refresh)
 *   }, [videoId, refresh])
 *
 *   return data
 * }
 */
export function createRefreshSubscription(
  videoId: string,
  dbName: DatabaseName,
  refresh: () => void | Promise<void>,
  options?: SubscribeOptions
): () => void {
  const { unsubscribe } = subscribeToChanges(
    videoId,
    dbName,
    () => {
      void refresh()
    },
    {
      ...options,
      // Default debounce for refresh
      debounce: options?.debounce ?? 100,
    }
  )

  return unsubscribe
}
