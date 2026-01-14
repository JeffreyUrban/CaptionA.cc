/**
 * WebSocket Sync Manager
 *
 * Manages WebSocket connections for CR-SQLite database synchronization.
 * Handles bidirectional sync, reconnection with exponential backoff,
 * and message queuing during disconnect.
 *
 * Message Types:
 * - From server: ack, server_update, lock_changed, session_transferred, error
 * - To server: sync
 */

import { type DatabaseName, WEBSOCKET_CONFIG, buildWebSocketUrl } from '~/config'
import {
  websocketClosedError,
  websocketError,
  syncError,
  syncTimeoutError,
  sessionTransferredError,
  logDatabaseError,
  type DatabaseError,
} from './database-errors'
import { type CRSQLiteChange } from './crsqlite-client'
import { getLockManager, type LockHolder, type LockState } from './database-lock'

// =============================================================================
// Types
// =============================================================================

/**
 * WebSocket connection state.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

/**
 * Message types from the server.
 */
export type ServerMessageType =
  | 'ack'
  | 'server_update'
  | 'lock_changed'
  | 'session_transferred'
  | 'error'

/**
 * Base server message interface.
 */
interface BaseServerMessage {
  type: ServerMessageType
  messageId?: string
}

/**
 * Acknowledgment message - changes applied successfully.
 */
export interface AckMessage extends BaseServerMessage {
  type: 'ack'
  version: number
}

/**
 * Server update message - server has changes for client.
 */
export interface ServerUpdateMessage extends BaseServerMessage {
  type: 'server_update'
  changes: CRSQLiteChange[]
  version: number
}

/**
 * Lock changed message - lock state changed.
 */
export interface LockChangedMessage extends BaseServerMessage {
  type: 'lock_changed'
  state: LockState
  holder?: {
    userId: string
    displayName?: string
    tabId?: string
  }
}

/**
 * Session transferred message - another tab took over.
 */
export interface SessionTransferredMessage extends BaseServerMessage {
  type: 'session_transferred'
  newTabId: string
}

/**
 * Error message from server.
 */
export interface ErrorMessage extends BaseServerMessage {
  type: 'error'
  code: string
  message: string
}

/**
 * Union of all server message types.
 */
export type ServerMessage =
  | AckMessage
  | ServerUpdateMessage
  | LockChangedMessage
  | SessionTransferredMessage
  | ErrorMessage

/**
 * Sync message to send to server.
 */
export interface SyncMessage {
  type: 'sync'
  messageId: string
  changes: CRSQLiteChange[]
  version: number
}

/**
 * Pending sync message awaiting acknowledgment.
 */
interface PendingMessage {
  message: SyncMessage
  sentAt: number
  retries: number
}

/**
 * WebSocket event handlers.
 */
export interface WebSocketEventHandlers {
  /** Called when connection state changes */
  onStateChange?: (state: ConnectionState) => void
  /** Called when changes are received from server */
  onChanges?: (changes: CRSQLiteChange[], version: number) => void
  /** Called when local changes are acknowledged */
  onAck?: (version: number) => void
  /** Called when lock state changes */
  onLockChanged?: (state: LockState, holder?: LockHolder) => void
  /** Called when session is transferred to another tab */
  onSessionTransferred?: (newTabId: string) => void
  /** Called when an error occurs */
  onError?: (error: DatabaseError) => void
}

// =============================================================================
// WebSocket Sync Manager
// =============================================================================

/**
 * WebSocket sync manager for a single database connection.
 */
export class WebSocketSyncManager {
  private ws: WebSocket | null = null
  private connectionState: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private reconnectTimeout: NodeJS.Timeout | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null

  // Message management
  private messageQueue: SyncMessage[] = []
  private pendingMessages = new Map<string, PendingMessage>()
  private messageIdCounter = 0

  // Debouncing for outgoing changes
  private pendingChanges: CRSQLiteChange[] = []
  private debounceTimeout: NodeJS.Timeout | null = null

  // Current version tracking
  private localVersion = 0

  readonly videoId: string
  readonly dbName: DatabaseName
  readonly instanceId: string
  private handlers: WebSocketEventHandlers

  constructor(
    videoId: string,
    dbName: DatabaseName,
    handlers: WebSocketEventHandlers = {}
  ) {
    this.videoId = videoId
    this.dbName = dbName
    this.instanceId = `${videoId}:${dbName}`
    this.handlers = handlers
  }

  /**
   * Get the current connection state.
   */
  get state(): ConnectionState {
    return this.connectionState
  }

  /**
   * Check if currently connected.
   */
  get isConnected(): boolean {
    return this.connectionState === 'connected'
  }

  /**
   * Get the number of pending changes.
   */
  get pendingCount(): number {
    return this.pendingChanges.length + this.messageQueue.length
  }

  /**
   * Connect to the WebSocket server.
   */
  async connect(authToken?: string): Promise<void> {
    if (this.ws && this.connectionState !== 'disconnected') {
      console.log(`[WebSocketSync] Already connected or connecting: ${this.instanceId}`)
      return
    }

    this.setConnectionState('connecting')

    try {
      const url = buildWebSocketUrl(this.videoId, this.dbName)
      const tabId = getLockManager().getTabId()

      // Add query parameters
      const wsUrl = new URL(url)
      wsUrl.searchParams.set('tab_id', tabId)
      if (authToken) {
        wsUrl.searchParams.set('token', authToken)
      }

      this.ws = new WebSocket(wsUrl.toString())

      // Set up event handlers
      this.ws.onopen = this.handleOpen.bind(this)
      this.ws.onclose = this.handleClose.bind(this)
      this.ws.onerror = this.handleError.bind(this)
      this.ws.onmessage = this.handleMessage.bind(this)

      // Wait for connection
      await this.waitForConnection()

      console.log(`[WebSocketSync] Connected: ${this.instanceId}`)
    } catch (error) {
      this.setConnectionState('error')
      const dbError = websocketError(error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Wait for WebSocket to connect.
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'))
        return
      }

      if (this.ws.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      const timeout = setTimeout(() => {
        reject(syncTimeoutError())
      }, 10000)

      const cleanup = () => {
        clearTimeout(timeout)
        if (this.ws) {
          this.ws.removeEventListener('open', onOpen)
          this.ws.removeEventListener('error', onError)
        }
      }

      const onOpen = () => {
        cleanup()
        resolve()
      }

      const onError = () => {
        cleanup()
        reject(websocketError())
      }

      this.ws.addEventListener('open', onOpen)
      this.ws.addEventListener('error', onError)
    })
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    this.stopHeartbeat()
    this.clearReconnectTimeout()

    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client disconnect')
      }

      this.ws = null
    }

    this.setConnectionState('disconnected')
    console.log(`[WebSocketSync] Disconnected: ${this.instanceId}`)
  }

  /**
   * Send local changes to the server.
   * Changes are debounced and batched for efficiency.
   */
  sendChanges(changes: CRSQLiteChange[], version: number): void {
    this.localVersion = version

    // Add to pending changes
    this.pendingChanges.push(...changes)

    // Debounce the send
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
    }

    this.debounceTimeout = setTimeout(() => {
      this.flushChanges()
    }, WEBSOCKET_CONFIG.DEBOUNCE_DELAY_MS)
  }

  /**
   * Flush pending changes immediately.
   */
  flushChanges(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }

    if (this.pendingChanges.length === 0) {
      return
    }

    const changes = [...this.pendingChanges]
    this.pendingChanges = []

    const message: SyncMessage = {
      type: 'sync',
      messageId: this.generateMessageId(),
      changes,
      version: this.localVersion,
    }

    if (this.isConnected && this.ws) {
      this.sendMessage(message)
    } else {
      // Queue for later
      this.messageQueue.push(message)
    }
  }

  /**
   * Set the current local version.
   */
  setLocalVersion(version: number): void {
    this.localVersion = version
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Set connection state and notify handlers.
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state
      this.handlers.onStateChange?.(state)
    }
  }

  /**
   * Generate a unique message ID.
   */
  private generateMessageId(): string {
    return `${this.instanceId}:${++this.messageIdCounter}:${Date.now()}`
  }

  /**
   * Send a message to the server.
   */
  private sendMessage(message: SyncMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push(message)
      return
    }

    try {
      this.ws.send(JSON.stringify(message))

      // Track pending message
      this.pendingMessages.set(message.messageId, {
        message,
        sentAt: Date.now(),
        retries: 0,
      })

      console.log(
        `[WebSocketSync] Sent sync message: ${message.messageId}, ` +
        `${message.changes.length} changes`
      )
    } catch (error) {
      console.error('[WebSocketSync] Failed to send message:', error)
      this.messageQueue.push(message)
    }
  }

  /**
   * Process queued messages after reconnection.
   */
  private processQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const message = this.messageQueue.shift()
      if (message) {
        this.sendMessage(message)
      }
    }
  }

  /**
   * Handle WebSocket open event.
   */
  private handleOpen(): void {
    this.setConnectionState('connected')
    this.reconnectAttempts = 0
    this.startHeartbeat()
    this.processQueue()
  }

  /**
   * Handle WebSocket close event.
   */
  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat()

    // Normal close (1000) or going away (1001) - don't reconnect
    if (event.code === 1000 || event.code === 1001) {
      this.setConnectionState('disconnected')
      return
    }

    // Log the close reason
    const error = websocketClosedError(event.code, event.reason)
    logDatabaseError(error)

    // Attempt to reconnect
    this.scheduleReconnect()
  }

  /**
   * Handle WebSocket error event.
   */
  private handleError(event: Event): void {
    const error = websocketError(event)
    logDatabaseError(error)
    this.handlers.onError?.(error)
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data as string) as ServerMessage

      switch (message.type) {
        case 'ack':
          this.handleAck(message)
          break

        case 'server_update':
          this.handleServerUpdate(message)
          break

        case 'lock_changed':
          this.handleLockChanged(message)
          break

        case 'session_transferred':
          this.handleSessionTransferred(message)
          break

        case 'error':
          this.handleServerError(message)
          break

        default:
          console.warn('[WebSocketSync] Unknown message type:', message)
      }
    } catch (error) {
      console.error('[WebSocketSync] Failed to parse message:', error)
    }
  }

  /**
   * Handle acknowledgment message.
   */
  private handleAck(message: AckMessage): void {
    // Remove from pending
    if (message.messageId) {
      this.pendingMessages.delete(message.messageId)
    }

    // Update local version
    this.localVersion = message.version

    // Notify handler
    this.handlers.onAck?.(message.version)

    console.log(`[WebSocketSync] Ack received, version: ${message.version}`)
  }

  /**
   * Handle server update message.
   */
  private handleServerUpdate(message: ServerUpdateMessage): void {
    console.log(
      `[WebSocketSync] Server update received: ${message.changes.length} changes, ` +
      `version: ${message.version}`
    )

    // Notify handler
    this.handlers.onChanges?.(message.changes, message.version)
  }

  /**
   * Handle lock changed message.
   */
  private handleLockChanged(message: LockChangedMessage): void {
    const holder: LockHolder | undefined = message.holder
      ? {
          userId: message.holder.userId,
          displayName: message.holder.displayName,
          isCurrentUser: message.holder.userId === getLockManager()['currentUserId'],
          tabId: message.holder.tabId,
        }
      : undefined

    // Update lock manager
    getLockManager().handleLockChanged(
      this.videoId,
      this.dbName,
      message.state,
      holder
    )

    // Notify handler
    this.handlers.onLockChanged?.(message.state, holder)

    console.log(`[WebSocketSync] Lock changed: ${message.state}`)
  }

  /**
   * Handle session transferred message.
   */
  private handleSessionTransferred(message: SessionTransferredMessage): void {
    console.log(`[WebSocketSync] Session transferred to tab: ${message.newTabId}`)

    // Disconnect without reconnecting
    this.disconnect()

    // Create error for handler
    const error = sessionTransferredError(message.newTabId)
    this.handlers.onError?.(error)
    this.handlers.onSessionTransferred?.(message.newTabId)
  }

  /**
   * Handle server error message.
   */
  private handleServerError(message: ErrorMessage): void {
    console.error(`[WebSocketSync] Server error: ${message.code} - ${message.message}`)

    const error = syncError(message.message)
    this.handlers.onError?.(error)
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return // Already scheduled
    }

    this.setConnectionState('reconnecting')

    // Calculate delay with exponential backoff
    const delay = Math.min(
      WEBSOCKET_CONFIG.RECONNECT_INITIAL_DELAY_MS *
        Math.pow(WEBSOCKET_CONFIG.RECONNECT_BACKOFF_MULTIPLIER, this.reconnectAttempts),
      WEBSOCKET_CONFIG.RECONNECT_MAX_DELAY_MS
    )

    console.log(
      `[WebSocketSync] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`
    )

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null
      this.reconnectAttempts++

      try {
        await this.connect()
      } catch {
        // Connection failed, schedule another attempt
        this.scheduleReconnect()
      }
    }, delay)
  }

  /**
   * Clear reconnect timeout.
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
  }

  /**
   * Start heartbeat interval.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send ping (empty message)
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }))
        } catch {
          // Ignore send errors
        }
      }
    }, WEBSOCKET_CONFIG.HEARTBEAT_INTERVAL_MS)
  }

  /**
   * Stop heartbeat interval.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    this.disconnect()

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }

    this.pendingChanges = []
    this.messageQueue = []
    this.pendingMessages.clear()
  }
}

// =============================================================================
// Sync Manager Registry
// =============================================================================

/** Active sync managers by instance ID */
const syncManagers = new Map<string, WebSocketSyncManager>()

/**
 * Get or create a sync manager for a database.
 */
export function getSyncManager(
  videoId: string,
  dbName: DatabaseName,
  handlers?: WebSocketEventHandlers
): WebSocketSyncManager {
  const instanceId = `${videoId}:${dbName}`

  let manager = syncManagers.get(instanceId)
  if (!manager) {
    manager = new WebSocketSyncManager(videoId, dbName, handlers)
    syncManagers.set(instanceId, manager)
  }

  return manager
}

/**
 * Remove a sync manager.
 */
export function removeSyncManager(videoId: string, dbName: DatabaseName): void {
  const instanceId = `${videoId}:${dbName}`
  const manager = syncManagers.get(instanceId)

  if (manager) {
    manager.cleanup()
    syncManagers.delete(instanceId)
  }
}

/**
 * Disconnect all sync managers.
 */
export function disconnectAllSyncManagers(): void {
  for (const manager of syncManagers.values()) {
    manager.cleanup()
  }
  syncManagers.clear()
}
