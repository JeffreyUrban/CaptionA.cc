/**
 * Database Lock Service
 *
 * Manages lock acquisition and release for CR-SQLite databases.
 * Locks are user-level (not session), enabling tab handoff.
 *
 * Lock States:
 * - checking: Checking current lock state
 * - acquiring: Attempting to acquire lock
 * - granted: Lock acquired, can edit
 * - denied: Another user has lock
 * - transferring: Same user, different tab (show handoff UI)
 * - server_processing: Server has lock for ML (read-only)
 */

import { type DatabaseName, buildLockUrl, buildDatabaseStateUrl, API_CONFIG } from '~/config'
import {
  lockDeniedError,
  lockExpiredError,
  lockAcquireError,
  lockReleaseError,
  sessionTransferredError,
  authRequiredError,
  networkError,
  logDatabaseError,
  type DatabaseError,
} from './database-errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Lock states for database access.
 */
export type LockState =
  | 'checking'
  | 'acquiring'
  | 'granted'
  | 'denied'
  | 'transferring'
  | 'server_processing'
  | 'released'
  | 'error'

/**
 * Lock holder information.
 */
export interface LockHolder {
  /** User ID of the lock holder */
  userId: string
  /** Display name of the lock holder (if available) */
  displayName?: string
  /** Whether this is the current user */
  isCurrentUser: boolean
  /** Tab ID if same user in different tab */
  tabId?: string
}

/**
 * Lock status response from the server.
 */
export interface LockStatus {
  /** Current lock state */
  state: LockState
  /** Lock holder information */
  holder?: LockHolder
  /** Whether current user can edit */
  canEdit: boolean
  /** Lock expiration time */
  expiresAt?: Date
  /** WebSocket URL for sync (if lock granted) */
  websocketUrl?: string
  /** Database version on server */
  serverVersion?: number
}

/**
 * Server response for database state.
 */
interface DatabaseStateResponse {
  version: number
  locked: boolean
  lock_holder_id?: string
  lock_holder_name?: string
  lock_holder_tab_id?: string
  lock_expires_at?: string
  server_processing?: boolean
}

/**
 * Server response for lock acquisition.
 */
interface LockAcquireResponse {
  success: boolean
  websocket_url?: string
  error?: string
  holder_id?: string
  holder_name?: string
  expires_at?: string
}

// =============================================================================
// Lock Manager
// =============================================================================

/**
 * Database lock manager.
 * Handles lock acquisition, release, and state checking.
 */
export class DatabaseLockManager {
  private currentUserId: string | null = null
  private currentTabId: string
  private lockStates = new Map<string, LockStatus>()
  private lockCheckIntervals = new Map<string, NodeJS.Timeout>()

  constructor() {
    // Generate a unique tab ID for this browser tab
    this.currentTabId = this.generateTabId()

    // Listen for beforeunload to release locks
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.releaseAllLocks()
      })
    }
  }

  /**
   * Generate a unique tab ID.
   */
  private generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Set the current user ID.
   * Should be called after authentication.
   */
  setCurrentUser(userId: string): void {
    this.currentUserId = userId
  }

  /**
   * Get the current tab ID.
   */
  getTabId(): string {
    return this.currentTabId
  }

  /**
   * Create a lock key for a video/database combination.
   */
  private createLockKey(videoId: string, dbName: DatabaseName): string {
    return `${videoId}:${dbName}`
  }

  /**
   * Get auth headers for API requests.
   */
  private async getAuthHeaders(): Promise<Headers> {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Tab-Id': this.currentTabId,
    })

    try {
      const { supabase } = await import('./supabase-client')
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`)
        this.currentUserId = session.user.id
      }
    } catch {
      // Ignore errors
    }

    return headers
  }

  /**
   * Check the current lock state for a database.
   */
  async checkLockState(videoId: string, dbName: DatabaseName): Promise<LockStatus> {
    const lockKey = this.createLockKey(videoId, dbName)

    try {
      const headers = await this.getAuthHeaders()
      const url = buildDatabaseStateUrl(videoId, dbName)

      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (response.status === 401) {
        throw authRequiredError()
      }

      if (!response.ok) {
        throw new Error(`Failed to check lock state: ${response.status}`)
      }

      const data: DatabaseStateResponse = await response.json()

      const status = this.parseStateResponse(data)
      this.lockStates.set(lockKey, status)

      return status
    } catch (error) {
      if ((error as DatabaseError).code) {
        throw error
      }

      const dbError = networkError(error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Parse server state response into LockStatus.
   */
  private parseStateResponse(data: DatabaseStateResponse): LockStatus {
    // Determine lock state
    let state: LockState = 'released'
    let holder: LockHolder | undefined

    if (data.server_processing) {
      state = 'server_processing'
    } else if (data.locked && data.lock_holder_id) {
      const isCurrentUser = data.lock_holder_id === this.currentUserId
      const isSameTab = data.lock_holder_tab_id === this.currentTabId

      holder = {
        userId: data.lock_holder_id,
        displayName: data.lock_holder_name,
        isCurrentUser,
        tabId: data.lock_holder_tab_id,
      }

      if (isCurrentUser) {
        if (isSameTab) {
          state = 'granted'
        } else {
          state = 'transferring'
        }
      } else {
        state = 'denied'
      }
    }

    return {
      state,
      holder,
      canEdit: state === 'granted',
      expiresAt: data.lock_expires_at ? new Date(data.lock_expires_at) : undefined,
      serverVersion: data.version,
    }
  }

  /**
   * Acquire a lock for a database.
   */
  async acquireLock(videoId: string, dbName: DatabaseName): Promise<LockStatus> {
    const lockKey = this.createLockKey(videoId, dbName)

    // Update state to acquiring
    const acquiringStatus: LockStatus = {
      state: 'acquiring',
      canEdit: false,
    }
    this.lockStates.set(lockKey, acquiringStatus)

    try {
      const headers = await this.getAuthHeaders()
      const url = buildLockUrl(videoId, dbName)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tab_id: this.currentTabId,
        }),
      })

      if (response.status === 401) {
        throw authRequiredError()
      }

      const data: LockAcquireResponse = await response.json()

      if (!response.ok || !data.success) {
        // Lock denied
        const holder: LockHolder | undefined = data.holder_id
          ? {
              userId: data.holder_id,
              displayName: data.holder_name,
              isCurrentUser: data.holder_id === this.currentUserId,
            }
          : undefined

        const deniedStatus: LockStatus = {
          state: holder?.isCurrentUser ? 'transferring' : 'denied',
          holder,
          canEdit: false,
        }
        this.lockStates.set(lockKey, deniedStatus)

        if (holder?.isCurrentUser) {
          throw sessionTransferredError(holder.tabId)
        } else {
          throw lockDeniedError(holder?.displayName || holder?.userId)
        }
      }

      // Lock granted
      const grantedStatus: LockStatus = {
        state: 'granted',
        holder: {
          userId: this.currentUserId || '',
          isCurrentUser: true,
          tabId: this.currentTabId,
        },
        canEdit: true,
        expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
        websocketUrl: data.websocket_url,
      }
      this.lockStates.set(lockKey, grantedStatus)

      // Start lock expiry monitoring
      this.startLockMonitor(videoId, dbName, grantedStatus.expiresAt)

      console.log(`[DatabaseLock] Lock acquired for ${lockKey}`)
      return grantedStatus
    } catch (error) {
      if ((error as DatabaseError).code) {
        throw error
      }

      const dbError = lockAcquireError(error)
      logDatabaseError(dbError)

      const errorStatus: LockStatus = {
        state: 'error',
        canEdit: false,
      }
      this.lockStates.set(lockKey, errorStatus)

      throw dbError
    }
  }

  /**
   * Release a lock for a database.
   */
  async releaseLock(videoId: string, dbName: DatabaseName): Promise<void> {
    const lockKey = this.createLockKey(videoId, dbName)

    // Stop monitoring
    this.stopLockMonitor(lockKey)

    try {
      const headers = await this.getAuthHeaders()
      const url = buildLockUrl(videoId, dbName)

      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      })

      if (response.status === 401) {
        throw authRequiredError()
      }

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to release lock: ${response.status}`)
      }

      const releasedStatus: LockStatus = {
        state: 'released',
        canEdit: false,
      }
      this.lockStates.set(lockKey, releasedStatus)

      console.log(`[DatabaseLock] Lock released for ${lockKey}`)
    } catch (error) {
      if ((error as DatabaseError).code) {
        throw error
      }

      const dbError = lockReleaseError(error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Request a lock transfer from another tab.
   */
  async requestTransfer(videoId: string, dbName: DatabaseName): Promise<LockStatus> {
    // First, attempt to acquire the lock
    // The server will handle notifying the other tab
    return this.acquireLock(videoId, dbName)
  }

  /**
   * Get the current lock status (from cache).
   */
  getLockStatus(videoId: string, dbName: DatabaseName): LockStatus | undefined {
    const lockKey = this.createLockKey(videoId, dbName)
    return this.lockStates.get(lockKey)
  }

  /**
   * Start monitoring lock expiry.
   */
  private startLockMonitor(videoId: string, dbName: DatabaseName, expiresAt?: Date): void {
    const lockKey = this.createLockKey(videoId, dbName)

    // Stop any existing monitor
    this.stopLockMonitor(lockKey)

    if (!expiresAt) {
      return
    }

    // Check lock status periodically
    const checkInterval = 30000 // 30 seconds

    const intervalId = setInterval(async () => {
      const now = new Date()
      const timeUntilExpiry = expiresAt.getTime() - now.getTime()

      if (timeUntilExpiry <= 0) {
        // Lock expired
        console.warn(`[DatabaseLock] Lock expired for ${lockKey}`)
        this.stopLockMonitor(lockKey)

        const expiredStatus: LockStatus = {
          state: 'error',
          canEdit: false,
        }
        this.lockStates.set(lockKey, expiredStatus)

        // Dispatch event for UI notification
        this.dispatchLockEvent(videoId, dbName, 'lock_expired')
      } else if (timeUntilExpiry <= 60000) {
        // Less than 1 minute until expiry - warn
        console.warn(`[DatabaseLock] Lock expiring soon for ${lockKey}`)
        this.dispatchLockEvent(videoId, dbName, 'lock_expiring')
      }
    }, checkInterval)

    this.lockCheckIntervals.set(lockKey, intervalId)
  }

  /**
   * Stop monitoring lock expiry.
   */
  private stopLockMonitor(lockKey: string): void {
    const intervalId = this.lockCheckIntervals.get(lockKey)
    if (intervalId) {
      clearInterval(intervalId)
      this.lockCheckIntervals.delete(lockKey)
    }
  }

  /**
   * Dispatch a lock event for UI handling.
   */
  private dispatchLockEvent(
    videoId: string,
    dbName: DatabaseName,
    type: 'lock_expired' | 'lock_expiring' | 'lock_transferred'
  ): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('database-lock', {
          detail: { videoId, dbName, type },
        })
      )
    }
  }

  /**
   * Release all held locks.
   * Called on page unload.
   */
  async releaseAllLocks(): Promise<void> {
    const releasePromises: Promise<void>[] = []

    for (const [lockKey, status] of this.lockStates.entries()) {
      if (status.state === 'granted') {
        const [videoId, dbName] = lockKey.split(':') as [string, DatabaseName]
        releasePromises.push(
          this.releaseLock(videoId, dbName).catch(error => {
            console.warn(`[DatabaseLock] Failed to release lock ${lockKey}:`, error)
          })
        )
      }
    }

    await Promise.all(releasePromises)
  }

  /**
   * Handle lock state change notification from WebSocket.
   */
  handleLockChanged(
    videoId: string,
    dbName: DatabaseName,
    newState: LockState,
    holder?: LockHolder
  ): void {
    const lockKey = this.createLockKey(videoId, dbName)
    const currentStatus = this.lockStates.get(lockKey)

    // If we had the lock and now we don't, someone took it
    if (currentStatus?.state === 'granted' && newState !== 'granted') {
      console.log(`[DatabaseLock] Lock transferred for ${lockKey}`)
      this.stopLockMonitor(lockKey)
      this.dispatchLockEvent(videoId, dbName, 'lock_transferred')
    }

    const newStatus: LockStatus = {
      state: newState,
      holder,
      canEdit: newState === 'granted' && holder?.isCurrentUser === true,
    }
    this.lockStates.set(lockKey, newStatus)
  }

  /**
   * Cleanup resources.
   */
  cleanup(): void {
    // Stop all monitors
    for (const lockKey of this.lockCheckIntervals.keys()) {
      this.stopLockMonitor(lockKey)
    }

    // Clear state
    this.lockStates.clear()
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/** Global lock manager instance */
let lockManager: DatabaseLockManager | null = null

/**
 * Get the global lock manager instance.
 */
export function getLockManager(): DatabaseLockManager {
  if (!lockManager) {
    lockManager = new DatabaseLockManager()
  }
  return lockManager
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Check lock state for a database.
 */
export async function checkLockState(videoId: string, dbName: DatabaseName): Promise<LockStatus> {
  return getLockManager().checkLockState(videoId, dbName)
}

/**
 * Acquire a lock for a database.
 */
export async function acquireLock(videoId: string, dbName: DatabaseName): Promise<LockStatus> {
  return getLockManager().acquireLock(videoId, dbName)
}

/**
 * Release a lock for a database.
 */
export async function releaseLock(videoId: string, dbName: DatabaseName): Promise<void> {
  return getLockManager().releaseLock(videoId, dbName)
}

/**
 * Get current lock status from cache.
 */
export function getLockStatus(videoId: string, dbName: DatabaseName): LockStatus | undefined {
  return getLockManager().getLockStatus(videoId, dbName)
}
