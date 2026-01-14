/**
 * Database Error Handling
 *
 * Structured error types for CR-SQLite browser infrastructure.
 * Each error has a code, message, and recoverable flag with recovery strategies.
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Error codes for database operations.
 */
export const DatabaseErrorCode = {
  // WASM/Initialization errors
  WASM_LOAD_FAILED: 'WASM_LOAD_FAILED',
  CRSQLITE_INIT_FAILED: 'CRSQLITE_INIT_FAILED',
  DATABASE_INIT_FAILED: 'DATABASE_INIT_FAILED',

  // Download/Decompress errors
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  DECOMPRESS_FAILED: 'DECOMPRESS_FAILED',
  CREDENTIALS_FAILED: 'CREDENTIALS_FAILED',

  // Sync errors
  SYNC_FAILED: 'SYNC_FAILED',
  WEBSOCKET_CLOSED: 'WEBSOCKET_CLOSED',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
  SYNC_TIMEOUT: 'SYNC_TIMEOUT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',

  // Lock errors
  LOCK_DENIED: 'LOCK_DENIED',
  LOCK_EXPIRED: 'LOCK_EXPIRED',
  LOCK_ACQUIRE_FAILED: 'LOCK_ACQUIRE_FAILED',
  LOCK_RELEASE_FAILED: 'LOCK_RELEASE_FAILED',

  // Session errors
  SESSION_TRANSFERRED: 'SESSION_TRANSFERRED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Query errors
  QUERY_FAILED: 'QUERY_FAILED',
  INVALID_QUERY: 'INVALID_QUERY',

  // General errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const

export type DatabaseErrorCode = (typeof DatabaseErrorCode)[keyof typeof DatabaseErrorCode]

// =============================================================================
// Error Interface
// =============================================================================

/**
 * Structured database error with recovery information.
 */
export interface DatabaseError {
  /** Error code for programmatic handling */
  code: DatabaseErrorCode

  /** Human-readable error message */
  message: string

  /** Whether this error can be recovered from */
  recoverable: boolean

  /** Original error that caused this error (if any) */
  cause?: unknown

  /** Additional context for debugging */
  context?: Record<string, unknown>
}

// =============================================================================
// Recovery Strategies
// =============================================================================

/**
 * Recovery strategy for a recoverable error.
 */
export type RecoveryStrategy =
  | 'retry'
  | 'reconnect'
  | 'reacquire_lock'
  | 'refresh_credentials'
  | 'reinitialize'
  | 'switch_tab'
  | 'login'
  | 'none'

/**
 * Get the recommended recovery strategy for an error.
 */
export function getRecoveryStrategy(error: DatabaseError): RecoveryStrategy {
  if (!error.recoverable) {
    return 'none'
  }

  switch (error.code) {
    // Retry strategies
    case DatabaseErrorCode.DOWNLOAD_FAILED:
    case DatabaseErrorCode.SYNC_FAILED:
    case DatabaseErrorCode.SYNC_TIMEOUT:
    case DatabaseErrorCode.QUERY_FAILED:
    case DatabaseErrorCode.NETWORK_ERROR:
      return 'retry'

    // Reconnect strategies
    case DatabaseErrorCode.WEBSOCKET_CLOSED:
    case DatabaseErrorCode.WEBSOCKET_ERROR:
      return 'reconnect'

    // Lock reacquisition
    case DatabaseErrorCode.LOCK_EXPIRED:
      return 'reacquire_lock'

    // Credential refresh
    case DatabaseErrorCode.CREDENTIALS_FAILED:
      return 'refresh_credentials'

    // Reinitialization
    case DatabaseErrorCode.WASM_LOAD_FAILED:
    case DatabaseErrorCode.CRSQLITE_INIT_FAILED:
    case DatabaseErrorCode.DATABASE_INIT_FAILED:
    case DatabaseErrorCode.DECOMPRESS_FAILED:
    case DatabaseErrorCode.VERSION_CONFLICT:
      return 'reinitialize'

    // Tab switch (another tab took over)
    case DatabaseErrorCode.SESSION_TRANSFERRED:
      return 'switch_tab'

    // Login required
    case DatabaseErrorCode.AUTH_REQUIRED:
      return 'login'

    // Non-recoverable
    case DatabaseErrorCode.LOCK_DENIED:
    case DatabaseErrorCode.LOCK_ACQUIRE_FAILED:
    case DatabaseErrorCode.LOCK_RELEASE_FAILED:
    case DatabaseErrorCode.PERMISSION_DENIED:
    case DatabaseErrorCode.INVALID_QUERY:
    case DatabaseErrorCode.UNKNOWN_ERROR:
    default:
      return 'none'
  }
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Create a structured database error.
 */
export function createDatabaseError(
  code: DatabaseErrorCode,
  message: string,
  options?: {
    recoverable?: boolean
    cause?: unknown
    context?: Record<string, unknown>
  }
): DatabaseError {
  // Default recoverability based on error code
  const defaultRecoverable = isRecoverableByDefault(code)

  return {
    code,
    message,
    recoverable: options?.recoverable ?? defaultRecoverable,
    cause: options?.cause,
    context: options?.context,
  }
}

/**
 * Check if an error code is recoverable by default.
 */
function isRecoverableByDefault(code: DatabaseErrorCode): boolean {
  switch (code) {
    // Generally recoverable
    case DatabaseErrorCode.DOWNLOAD_FAILED:
    case DatabaseErrorCode.SYNC_FAILED:
    case DatabaseErrorCode.WEBSOCKET_CLOSED:
    case DatabaseErrorCode.WEBSOCKET_ERROR:
    case DatabaseErrorCode.SYNC_TIMEOUT:
    case DatabaseErrorCode.LOCK_EXPIRED:
    case DatabaseErrorCode.CREDENTIALS_FAILED:
    case DatabaseErrorCode.QUERY_FAILED:
    case DatabaseErrorCode.NETWORK_ERROR:
      return true

    // Might be recoverable with user action
    case DatabaseErrorCode.SESSION_TRANSFERRED:
    case DatabaseErrorCode.AUTH_REQUIRED:
      return true

    // Reinitializable but might need user intervention
    case DatabaseErrorCode.WASM_LOAD_FAILED:
    case DatabaseErrorCode.CRSQLITE_INIT_FAILED:
    case DatabaseErrorCode.DATABASE_INIT_FAILED:
    case DatabaseErrorCode.DECOMPRESS_FAILED:
    case DatabaseErrorCode.VERSION_CONFLICT:
      return true

    // Generally not recoverable
    case DatabaseErrorCode.LOCK_DENIED:
    case DatabaseErrorCode.LOCK_ACQUIRE_FAILED:
    case DatabaseErrorCode.LOCK_RELEASE_FAILED:
    case DatabaseErrorCode.PERMISSION_DENIED:
    case DatabaseErrorCode.INVALID_QUERY:
    case DatabaseErrorCode.UNKNOWN_ERROR:
    default:
      return false
  }
}

// =============================================================================
// Convenience Error Creators
// =============================================================================

export function wasmLoadError(cause?: unknown): DatabaseError {
  return createDatabaseError(
    DatabaseErrorCode.WASM_LOAD_FAILED,
    'Failed to load WebAssembly module for SQLite',
    { cause }
  )
}

export function crsqliteInitError(cause?: unknown): DatabaseError {
  return createDatabaseError(
    DatabaseErrorCode.CRSQLITE_INIT_FAILED,
    'Failed to initialize CR-SQLite extension',
    { cause }
  )
}

export function databaseInitError(dbName: string, cause?: unknown): DatabaseError {
  return createDatabaseError(
    DatabaseErrorCode.DATABASE_INIT_FAILED,
    `Failed to initialize database: ${dbName}`,
    { cause, context: { dbName } }
  )
}

export function downloadError(url: string, cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.DOWNLOAD_FAILED, `Failed to download database from ${url}`, {
    cause,
    context: { url },
  })
}

export function decompressError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.DECOMPRESS_FAILED, 'Failed to decompress database file', {
    cause,
  })
}

export function credentialsError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.CREDENTIALS_FAILED, 'Failed to obtain S3 credentials', {
    cause,
  })
}

export function syncError(message: string, cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.SYNC_FAILED, message, { cause })
}

export function websocketClosedError(code: number, reason: string): DatabaseError {
  return createDatabaseError(
    DatabaseErrorCode.WEBSOCKET_CLOSED,
    `WebSocket connection closed: ${reason || 'unknown reason'}`,
    { context: { code, reason } }
  )
}

export function websocketError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.WEBSOCKET_ERROR, 'WebSocket connection error', { cause })
}

export function syncTimeoutError(): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.SYNC_TIMEOUT, 'Sync operation timed out')
}

export function versionConflictError(localVersion: number, serverVersion: number): DatabaseError {
  return createDatabaseError(
    DatabaseErrorCode.VERSION_CONFLICT,
    `Database version conflict: local=${localVersion}, server=${serverVersion}`,
    { context: { localVersion, serverVersion } }
  )
}

export function lockDeniedError(holder?: string): DatabaseError {
  const message = holder ? `Lock denied: currently held by ${holder}` : 'Lock denied: database is locked'
  return createDatabaseError(DatabaseErrorCode.LOCK_DENIED, message, {
    recoverable: false,
    context: { holder },
  })
}

export function lockExpiredError(): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.LOCK_EXPIRED, 'Database lock has expired')
}

export function lockAcquireError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.LOCK_ACQUIRE_FAILED, 'Failed to acquire database lock', {
    cause,
  })
}

export function lockReleaseError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.LOCK_RELEASE_FAILED, 'Failed to release database lock', {
    cause,
  })
}

export function sessionTransferredError(newTabId?: string): DatabaseError {
  return createDatabaseError(
    DatabaseErrorCode.SESSION_TRANSFERRED,
    'Session transferred to another tab',
    { context: { newTabId } }
  )
}

export function authRequiredError(): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.AUTH_REQUIRED, 'Authentication required')
}

export function permissionDeniedError(resource?: string): DatabaseError {
  const message = resource ? `Permission denied for ${resource}` : 'Permission denied'
  return createDatabaseError(DatabaseErrorCode.PERMISSION_DENIED, message, {
    recoverable: false,
    context: { resource },
  })
}

export function queryError(query: string, cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.QUERY_FAILED, 'Database query failed', {
    cause,
    context: { query: query.substring(0, 200) }, // Truncate for safety
  })
}

export function invalidQueryError(reason: string): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.INVALID_QUERY, `Invalid query: ${reason}`, {
    recoverable: false,
  })
}

export function networkError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.NETWORK_ERROR, 'Network error occurred', { cause })
}

export function unknownError(cause?: unknown): DatabaseError {
  return createDatabaseError(DatabaseErrorCode.UNKNOWN_ERROR, 'An unknown error occurred', {
    cause,
    recoverable: false,
  })
}

// =============================================================================
// Error Type Guard
// =============================================================================

/**
 * Check if an error is a DatabaseError.
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'recoverable' in error &&
    typeof (error as DatabaseError).code === 'string' &&
    typeof (error as DatabaseError).message === 'string' &&
    typeof (error as DatabaseError).recoverable === 'boolean'
  )
}

/**
 * Convert any error to a DatabaseError.
 */
export function toDatabaseError(error: unknown): DatabaseError {
  if (isDatabaseError(error)) {
    return error
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (error.name === 'AbortError') {
      return syncTimeoutError()
    }
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return networkError(error)
    }
    return unknownError(error)
  }

  return unknownError(error)
}

// =============================================================================
// Error Logging
// =============================================================================

/**
 * Log a database error with appropriate severity.
 */
export function logDatabaseError(error: DatabaseError, prefix = '[Database]'): void {
  const logData = {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    context: error.context,
    cause: error.cause instanceof Error ? error.cause.message : error.cause,
  }

  if (error.recoverable) {
    console.warn(`${prefix} ${error.message}`, logData)
  } else {
    console.error(`${prefix} ${error.message}`, logData)
  }
}
