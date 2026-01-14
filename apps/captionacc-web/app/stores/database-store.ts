/**
 * Database Store - Zustand store for CR-SQLite database state
 *
 * Manages multiple database instances (layout.db, captions.db per video).
 * Tracks sync status, lock status, and provides actions for database operations.
 *
 * Design Principles:
 * - Singleton pattern: One database instance per (videoId, dbName) pair
 * - Reactive: Changes trigger subscriptions for React re-renders
 * - Memory management: Explicit cleanup, WeakMap for GC tracking
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import { type DatabaseName, DATABASE_NAMES } from '~/config'
import { CRSQLiteDatabase, type CRSQLiteChange, createInstanceId } from '~/services/crsqlite-client'
import { downloadDatabaseWithRetry, type DownloadProgress } from '~/services/database-loader'
import {
  acquireLock,
  releaseLock,
  checkLockState,
  type LockStatus,
  type LockState,
  type LockHolder,
} from '~/services/database-lock'
import { getSyncManager, removeSyncManager, type ConnectionState } from '~/services/websocket-sync'
import { notifySubscribers, clearSubscriptions } from '~/services/database-subscriptions'
import { type DatabaseError, logDatabaseError, toDatabaseError } from '~/services/database-errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Sync status for a database connection.
 */
export interface SyncStatus {
  /** WebSocket connection state */
  connected: boolean
  /** Whether currently syncing changes */
  syncing: boolean
  /** Timestamp of last successful sync */
  lastSyncTime: number | null
  /** Number of pending local changes */
  pendingChanges: number
  /** Connection state details */
  connectionState: ConnectionState
}

/**
 * Database instance state.
 */
export interface DatabaseInstance {
  /** Video ID */
  videoId: string
  /** Database name */
  dbName: DatabaseName
  /** Instance ID (videoId:dbName) */
  instanceId: string
  /** CR-SQLite database handle */
  database: CRSQLiteDatabase | null
  /** Whether the database is ready for queries */
  ready: boolean
  /** Current database version */
  version: number
  /** Sync status */
  syncStatus: SyncStatus
  /** Lock status */
  lockStatus: LockStatus | null
  /** Download progress (if downloading) */
  downloadProgress: DownloadProgress | null
  /** Last error */
  error: DatabaseError | null
  /** Timestamp when initialized */
  initializedAt: number | null
}

/**
 * Database store state.
 */
export interface DatabaseStoreState {
  /** Database instances by instanceId */
  instances: Record<string, DatabaseInstance>
  /** Currently active instance ID */
  activeInstanceId: string | null
}

/**
 * Database store actions.
 */
export interface DatabaseStoreActions {
  // Lifecycle
  /**
   * Initialize a database for a video.
   * Downloads from Wasabi if needed and sets up sync.
   */
  initializeDatabase: (
    tenantId: string,
    videoId: string,
    dbName: DatabaseName,
    options?: InitializeDatabaseOptions
  ) => Promise<CRSQLiteDatabase>

  /**
   * Close a database and release resources.
   */
  closeDatabase: (videoId: string, dbName: DatabaseName) => Promise<void>

  /**
   * Close all databases.
   */
  closeAllDatabases: () => Promise<void>

  // Lock management
  /**
   * Acquire a lock for editing.
   */
  acquireLock: (videoId: string, dbName: DatabaseName) => Promise<LockStatus>

  /**
   * Release the editing lock.
   */
  releaseLock: (videoId: string, dbName: DatabaseName) => Promise<void>

  /**
   * Check current lock status.
   */
  checkLock: (videoId: string, dbName: DatabaseName) => Promise<LockStatus>

  // Query helpers
  /**
   * Get a database instance for querying.
   */
  getDatabase: (videoId: string, dbName: DatabaseName) => CRSQLiteDatabase | null

  /**
   * Execute a query on a database.
   */
  query: <T = Record<string, unknown>>(
    videoId: string,
    dbName: DatabaseName,
    sql: string,
    params?: unknown[]
  ) => Promise<T[]>

  /**
   * Execute a statement (insert/update/delete) on a database.
   */
  execute: (
    videoId: string,
    dbName: DatabaseName,
    sql: string,
    params?: unknown[]
  ) => Promise<number>

  // State updates (internal)
  setInstanceState: (instanceId: string, updates: Partial<DatabaseInstance>) => void
  setActiveInstance: (instanceId: string | null) => void
  setSyncStatus: (instanceId: string, status: Partial<SyncStatus>) => void
  setLockStatus: (instanceId: string, status: LockStatus | null) => void
  setDownloadProgress: (instanceId: string, progress: DownloadProgress | null) => void
  setError: (instanceId: string, error: DatabaseError | null) => void

  // Internal methods
  setupSync: (instanceId: string, database: CRSQLiteDatabase) => Promise<void>
}

/**
 * Options for database initialization.
 */
export interface InitializeDatabaseOptions {
  /** Whether to acquire a lock for editing */
  acquireLock?: boolean
  /** Force download even if cached */
  forceDownload?: boolean
  /** Callback for download progress */
  onProgress?: (progress: DownloadProgress) => void
}

/**
 * Complete database store type.
 */
export type DatabaseStore = DatabaseStoreState & DatabaseStoreActions

// =============================================================================
// Initial State
// =============================================================================

const initialSyncStatus: SyncStatus = {
  connected: false,
  syncing: false,
  lastSyncTime: null,
  pendingChanges: 0,
  connectionState: 'disconnected',
}

function createInitialInstance(videoId: string, dbName: DatabaseName): DatabaseInstance {
  return {
    videoId,
    dbName,
    instanceId: createInstanceId(videoId, dbName),
    database: null,
    ready: false,
    version: 0,
    syncStatus: { ...initialSyncStatus },
    lockStatus: null,
    downloadProgress: null,
    error: null,
    initializedAt: null,
  }
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useDatabaseStore = create<DatabaseStore>()(
  persist(
    (set, get) => ({
      // Initial state
      instances: {},
      activeInstanceId: null,

      // ===========================================================================
      // Lifecycle Actions
      // ===========================================================================

      initializeDatabase: async (tenantId, videoId, dbName, options = {}) => {
        const instanceId = createInstanceId(videoId, dbName)
        const state = get()

        // Check if already initialized
        let instance = state.instances[instanceId]
        if (instance?.ready && instance.database) {
          console.log(`[DatabaseStore] Database already initialized: ${instanceId}`)
          return instance.database
        }

        // Create or update instance
        instance = instance || createInitialInstance(videoId, dbName)
        instance.error = null

        set(state => ({
          instances: { ...state.instances, [instanceId]: instance },
          activeInstanceId: instanceId,
        }))

        try {
          // Download database from Wasabi
          const downloadResult = await downloadDatabaseWithRetry(
            tenantId,
            videoId,
            dbName,
            progress => {
              get().setDownloadProgress(instanceId, progress)
              options.onProgress?.(progress)
            }
          )

          // Initialize CR-SQLite database
          const database = await CRSQLiteDatabase.open({
            videoId,
            dbName,
            data: downloadResult.data,
          })

          // Get version info
          const versionInfo = await database.getVersionInfo()

          // Update instance state
          get().setInstanceState(instanceId, {
            database,
            ready: true,
            version: versionInfo.version,
            downloadProgress: null,
            initializedAt: Date.now(),
          })

          // Set up WebSocket sync
          await get().setupSync(instanceId, database)

          // Acquire lock if requested
          if (options.acquireLock) {
            try {
              const lockStatus = await acquireLock(videoId, dbName)
              get().setLockStatus(instanceId, lockStatus)
            } catch (error) {
              // Lock failure is not fatal - we can still read
              console.warn(`[DatabaseStore] Failed to acquire lock:`, error)
              const lockCheck = await checkLockState(videoId, dbName)
              get().setLockStatus(instanceId, lockCheck)
            }
          }

          console.log(`[DatabaseStore] Database initialized: ${instanceId}`)
          return database
        } catch (error) {
          const dbError = toDatabaseError(error)
          logDatabaseError(dbError, '[DatabaseStore]')

          get().setInstanceState(instanceId, {
            error: dbError,
            ready: false,
            downloadProgress: null,
          })

          throw dbError
        }
      },

      closeDatabase: async (videoId, dbName) => {
        const instanceId = createInstanceId(videoId, dbName)
        const instance = get().instances[instanceId]

        if (!instance) {
          return
        }

        try {
          // Release lock if held
          if (instance.lockStatus?.canEdit) {
            try {
              await releaseLock(videoId, dbName)
            } catch {
              // Ignore lock release errors
            }
          }

          // Disconnect sync
          removeSyncManager(videoId, dbName)

          // Clear subscriptions
          clearSubscriptions(videoId, dbName)

          // Close database
          if (instance.database) {
            await instance.database.close()
          }

          // Remove from state
          set(state => {
            const { [instanceId]: _removed, ...remaining } = state.instances
            return {
              instances: remaining,
              activeInstanceId:
                state.activeInstanceId === instanceId ? null : state.activeInstanceId,
            }
          })

          console.log(`[DatabaseStore] Database closed: ${instanceId}`)
        } catch (error) {
          const dbError = toDatabaseError(error)
          logDatabaseError(dbError, '[DatabaseStore]')
          throw dbError
        }
      },

      closeAllDatabases: async () => {
        const state = get()
        const closePromises = Object.values(state.instances).map(instance =>
          get().closeDatabase(instance.videoId, instance.dbName)
        )
        await Promise.all(closePromises)
      },

      // ===========================================================================
      // Lock Management
      // ===========================================================================

      acquireLock: async (videoId, dbName) => {
        const instanceId = createInstanceId(videoId, dbName)
        const lockStatus = await acquireLock(videoId, dbName)
        get().setLockStatus(instanceId, lockStatus)
        return lockStatus
      },

      releaseLock: async (videoId, dbName) => {
        const instanceId = createInstanceId(videoId, dbName)
        await releaseLock(videoId, dbName)
        get().setLockStatus(instanceId, {
          state: 'released',
          canEdit: false,
        })
      },

      checkLock: async (videoId, dbName) => {
        const instanceId = createInstanceId(videoId, dbName)
        const lockStatus = await checkLockState(videoId, dbName)
        get().setLockStatus(instanceId, lockStatus)
        return lockStatus
      },

      // ===========================================================================
      // Query Helpers
      // ===========================================================================

      getDatabase: (videoId, dbName) => {
        const instanceId = createInstanceId(videoId, dbName)
        return get().instances[instanceId]?.database || null
      },

      query: async (videoId, dbName, sql, params) => {
        const database = get().getDatabase(videoId, dbName)
        if (!database) {
          throw new Error(`Database not initialized: ${videoId}:${dbName}`)
        }
        const result = await database.query(sql, params)
        return result.rows as any[]
      },

      execute: async (videoId, dbName, sql, params) => {
        const instanceId = createInstanceId(videoId, dbName)
        const instance = get().instances[instanceId]
        const database = instance?.database

        if (!database) {
          throw new Error(`Database not initialized: ${instanceId}`)
        }

        // Check if we have edit permission
        if (!instance.lockStatus?.canEdit) {
          throw new Error(`Cannot edit: lock not held for ${instanceId}`)
        }

        const rowsAffected = await database.exec(sql, params)

        // Get changes and send to sync
        const versionInfo = await database.getVersionInfo()
        const changes = await database.getChangesSince(instance.version)

        if (changes.length > 0) {
          // Update version
          get().setInstanceState(instanceId, {
            version: versionInfo.version,
          })

          // Send changes via WebSocket
          const syncManager = getSyncManager(videoId, dbName)
          syncManager.sendChanges(changes, versionInfo.version)

          // Update pending count
          get().setSyncStatus(instanceId, {
            pendingChanges: syncManager.pendingCount,
          })
        }

        return rowsAffected
      },

      // ===========================================================================
      // State Updates
      // ===========================================================================

      setInstanceState: (instanceId, updates) => {
        set(state => {
          const instance = state.instances[instanceId]
          if (!instance) return state

          return {
            instances: {
              ...state.instances,
              [instanceId]: { ...instance, ...updates },
            },
          }
        })
      },

      setActiveInstance: instanceId => {
        set({ activeInstanceId: instanceId })
      },

      setSyncStatus: (instanceId, status) => {
        set(state => {
          const instance = state.instances[instanceId]
          if (!instance) return state

          return {
            instances: {
              ...state.instances,
              [instanceId]: {
                ...instance,
                syncStatus: { ...instance.syncStatus, ...status },
              },
            },
          }
        })
      },

      setLockStatus: (instanceId, status) => {
        get().setInstanceState(instanceId, { lockStatus: status })
      },

      setDownloadProgress: (instanceId, progress) => {
        get().setInstanceState(instanceId, { downloadProgress: progress })
      },

      setError: (instanceId, error) => {
        get().setInstanceState(instanceId, { error })
      },

      // ===========================================================================
      // Sync Setup
      // ===========================================================================

      setupSync: async (instanceId, database) => {
        const parts = instanceId.split(':')
        const videoId = parts[0]
        const dbName = parts[1] as DatabaseName

        if (!videoId || !dbName) {
          console.error('[DatabaseStore] Invalid instanceId:', instanceId)
          return
        }

        // Get auth token
        let authToken: string | undefined
        try {
          const { supabase } = await import('~/services/supabase-client')
          const {
            data: { session },
          } = await supabase.auth.getSession()
          authToken = session?.access_token
        } catch {
          // Continue without auth
        }

        // Create sync manager with handlers
        const store = get()
        const syncManager = getSyncManager(videoId, dbName, {
          onStateChange: state => {
            store.setSyncStatus(instanceId, {
              connected: state === 'connected',
              connectionState: state,
            })
          },
          onChanges: async (changes, version) => {
            // Apply changes to local database
            await database.applyChanges(changes)

            // Update version
            store.setInstanceState(instanceId, { version })

            // Notify subscribers
            notifySubscribers(videoId, dbName, changes)

            // Update sync status
            store.setSyncStatus(instanceId, {
              lastSyncTime: Date.now(),
              syncing: false,
            })
          },
          onAck: version => {
            store.setInstanceState(instanceId, { version })
            store.setSyncStatus(instanceId, {
              pendingChanges: syncManager.pendingCount,
              syncing: false,
            })
          },
          onLockChanged: (state, holder) => {
            store.setLockStatus(instanceId, {
              state,
              holder,
              canEdit: state === 'granted',
            })
          },
          onSessionTransferred: newTabId => {
            // Handle session transfer
            console.log(`[DatabaseStore] Session transferred to tab: ${newTabId}`)
            store.setLockStatus(instanceId, {
              state: 'transferring',
              canEdit: false,
            })
          },
          onError: error => {
            logDatabaseError(error, '[DatabaseStore]')
            store.setError(instanceId, error)
          },
        })

        // Set initial version
        const versionInfo = await database.getVersionInfo()
        syncManager.setLocalVersion(versionInfo.version)

        // Connect
        await syncManager.connect(authToken)
      },
    }),
    {
      name: 'database-store',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist instance IDs, not actual database handles
      partialize: state => ({
        activeInstanceId: state.activeInstanceId,
        // Store instance metadata only
        instanceMeta: Object.fromEntries(
          Object.entries(state.instances).map(([id, inst]) => [
            id,
            {
              videoId: inst.videoId,
              dbName: inst.dbName,
              version: inst.version,
              initializedAt: inst.initializedAt,
            },
          ])
        ),
      }),
    }
  )
)

// =============================================================================
// Convenience Hooks
// =============================================================================

/**
 * Get database instance state.
 */
export function useDatabaseInstance(
  videoId: string,
  dbName: DatabaseName
): DatabaseInstance | null {
  const instanceId = createInstanceId(videoId, dbName)
  return useDatabaseStore(state => state.instances[instanceId] || null)
}

/**
 * Get sync status for a database.
 */
export function useSyncStatus(videoId: string, dbName: DatabaseName): SyncStatus {
  const instanceId = createInstanceId(videoId, dbName)
  return useDatabaseStore(state => state.instances[instanceId]?.syncStatus || initialSyncStatus)
}

/**
 * Get lock status for a database.
 */
export function useLockStatus(videoId: string, dbName: DatabaseName): LockStatus | null {
  const instanceId = createInstanceId(videoId, dbName)
  return useDatabaseStore(state => state.instances[instanceId]?.lockStatus || null)
}

/**
 * Check if a database is ready for queries.
 */
export function useIsDatabaseReady(videoId: string, dbName: DatabaseName): boolean {
  const instanceId = createInstanceId(videoId, dbName)
  return useDatabaseStore(state => state.instances[instanceId]?.ready || false)
}

/**
 * Get download progress for a database.
 */
export function useDownloadProgress(
  videoId: string,
  dbName: DatabaseName
): DownloadProgress | null {
  const instanceId = createInstanceId(videoId, dbName)
  return useDatabaseStore(state => state.instances[instanceId]?.downloadProgress || null)
}

/**
 * Get the last error for a database.
 */
export function useDatabaseError(videoId: string, dbName: DatabaseName): DatabaseError | null {
  const instanceId = createInstanceId(videoId, dbName)
  return useDatabaseStore(state => state.instances[instanceId]?.error || null)
}
