/**
 * Application Configuration
 *
 * Centralized configuration for API endpoints and external services.
 * All environment variables are required and must be set in .env file.
 */

// =============================================================================
// API Configuration
// =============================================================================

/**
 * Python backend API configuration.
 * Used for CR-SQLite sync, database locks, and video management.
 */
export const API_CONFIG = {
  /** Base URL for Python API (FastAPI backend) */
  PYTHON_API_URL: import.meta.env['VITE_API_URL']!,

  /** Supabase project URL */
  SUPABASE_URL: import.meta.env['VITE_SUPABASE_URL']!,

  /** Supabase anonymous key for client-side auth */
  SUPABASE_ANON_KEY: import.meta.env['VITE_SUPABASE_ANON_KEY']!,
} as const

// =============================================================================
// WebSocket Configuration
// =============================================================================

/**
 * WebSocket configuration for CR-SQLite sync.
 */
export const WEBSOCKET_CONFIG = {
  /** Debounce delay for outgoing changes (ms) */
  DEBOUNCE_DELAY_MS: 100,

  /** Initial reconnection delay (ms) */
  RECONNECT_INITIAL_DELAY_MS: 1000,

  /** Maximum reconnection delay (ms) */
  RECONNECT_MAX_DELAY_MS: 30000,

  /** Backoff multiplier for reconnection */
  RECONNECT_BACKOFF_MULTIPLIER: 2,

  /** Heartbeat interval for connection keep-alive (ms) */
  HEARTBEAT_INTERVAL_MS: 30000,
} as const

// =============================================================================
// Database Configuration
// =============================================================================

/**
 * Database names used in the system.
 */
export const DATABASE_NAMES = {
  /** Layout annotation database */
  LAYOUT: 'layout',

  /** Caption annotation database */
  CAPTIONS: 'captions',
} as const

export type DatabaseName = (typeof DATABASE_NAMES)[keyof typeof DATABASE_NAMES]

// =============================================================================
// S3/Wasabi Configuration
// =============================================================================

/**
 * Wasabi S3 configuration for database downloads.
 */
export const WASABI_CONFIG = {
  /** Wasabi region */
  REGION: 'us-east-1',

  /** Wasabi bucket name */
  BUCKET: 'captionacc-prod',

  /** Wasabi endpoint URL */
  ENDPOINT: 'https://s3.us-east-1.wasabisys.com',

  /** Database file extension for compressed files */
  COMPRESSED_EXTENSION: '.db.gz',
} as const

// =============================================================================
// Lock Configuration
// =============================================================================

/**
 * Lock management configuration.
 */
export const LOCK_CONFIG = {
  /** Lock check interval (ms) */
  CHECK_INTERVAL_MS: 5000,

  /** Lock timeout warning threshold (ms before expiry) */
  EXPIRY_WARNING_MS: 60000,

  /** Maximum lock duration (server-enforced, 15 minutes) */
  MAX_DURATION_MS: 15 * 60 * 1000,
} as const

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build the WebSocket URL for a specific video and database.
 */
export function buildWebSocketUrl(videoId: string, dbName: DatabaseName): string {
  const baseUrl = API_CONFIG.PYTHON_API_URL
  // Convert https:// to wss:// and http:// to ws://
  const wsUrl = baseUrl.replace(/^http/, 'ws')
  return `${wsUrl}/videos/${videoId}/sync/${dbName}`
}

/**
 * Build the database state endpoint URL.
 */
export function buildDatabaseStateUrl(videoId: string, dbName: DatabaseName): string {
  return `${API_CONFIG.PYTHON_API_URL}/videos/${videoId}/database/${dbName}/state`
}

/**
 * Build the lock endpoint URL.
 */
export function buildLockUrl(videoId: string, dbName: DatabaseName): string {
  return `${API_CONFIG.PYTHON_API_URL}/videos/${videoId}/database/${dbName}/lock`
}

/**
 * Build the Wasabi storage key for a database file.
 * Format: {tenant_id}/client/videos/{video_id}/{dbName}.db.gz
 */
export function buildStorageKey(tenantId: string, videoId: string, dbName: DatabaseName): string {
  return `${tenantId}/client/videos/${videoId}/${dbName}${WASABI_CONFIG.COMPRESSED_EXTENSION}`
}
