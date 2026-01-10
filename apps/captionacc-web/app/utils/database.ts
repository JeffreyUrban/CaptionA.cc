/**
 * Database access utilities for annotation API routes.
 *
 * This module provides standardized database access patterns including:
 * - Read-only database access for queries
 * - Read-write access with automatic database creation
 * - Transaction wrappers with automatic rollback on error
 *
 * All functions return Response objects on error (not throw) to allow
 * clean early returns in route handlers.
 */

import { existsSync } from 'fs'

import Database from 'better-sqlite3'

import { migrateDatabase } from '~/db/migrate'
import { notFoundResponse, errorResponse } from '~/utils/api-responses'
import { getCaptionsDbPath, getLayoutDbPath, getVideoDir } from '~/utils/video-paths'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Result type for database access functions.
 * Either contains the database instance or a Response for the error case.
 */
export type DatabaseResult =
  | { success: true; db: Database.Database }
  | { success: false; response: Response }

/**
 * Options for database access functions.
 */
export interface DatabaseOptions {
  /** Open in read-only mode (default: false for getCaptionDb, ignored for getOrCreate) */
  readonly?: boolean
}

/**
 * Options for transaction wrapper.
 */
export interface TransactionOptions {
  /** Whether to create the database if it doesn't exist (default: false) */
  createIfMissing?: boolean
  /** Open in read-only mode - incompatible with createIfMissing (default: false) */
  readonly?: boolean
}

// =============================================================================
// Database Access Functions
// =============================================================================

/**
 * Get a read-only database connection for a video.
 *
 * Returns an error Response if the video or database doesn't exist.
 * The caller is responsible for closing the database when done.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @returns DatabaseResult with database instance or error response
 *
 * @example
 * const result = await getCaptionDb(videoId)
 * if (!result.success) return result.response
 * const db = result.db
 * try {
 *   // ... use database
 * } finally {
 *   db.close()
 * }
 */
export async function getCaptionDb(videoId: string): Promise<DatabaseResult> {
  const { existsSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  const dbPath = await getCaptionsDbPath(videoId)
  if (!dbPath) {
    return {
      success: false,
      response: notFoundResponse('Video not found'),
    }
  }

  if (!existsSync(dbPath)) {
    return {
      success: false,
      response: notFoundResponse(`Database not found for video: ${videoId}`),
    }
  }

  try {
    const db = new Database(dbPath, { readonly: true })
    // Enable WAL mode for better concurrent access
    // WAL allows reads to proceed while writes are happening
    db.pragma('journal_mode = WAL')
    return { success: true, db }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open database'
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

/**
 * Get a read-write database connection for a video.
 *
 * Unlike getCaptionDb, this opens the database in read-write mode.
 * Returns an error Response if the video or database doesn't exist.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @returns DatabaseResult with database instance or error response
 */
export async function getWritableCaptionDb(videoId: string): Promise<DatabaseResult> {
  const { existsSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  const dbPath = await getCaptionsDbPath(videoId)
  if (!dbPath) {
    return {
      success: false,
      response: notFoundResponse('Video not found'),
    }
  }

  if (!existsSync(dbPath)) {
    return {
      success: false,
      response: notFoundResponse(`Database not found for video: ${videoId}`),
    }
  }

  try {
    // Run migrations before opening for writing
    migrateDatabase(dbPath)

    const db = new Database(dbPath)
    // Enable WAL mode for better concurrent access
    // WAL allows reads to proceed while writes are happening
    db.pragma('journal_mode = WAL')
    return { success: true, db }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open database'
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

/**
 * Get or create an annotation database for a video.
 *
 * Creates the database file if it doesn't exist. Does NOT create schema -
 * that should be done separately using init-annotations-db.ts or migrations.
 *
 * Note: This function is for backwards compatibility. New databases should
 * be initialized using the proper schema creation scripts.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @returns DatabaseResult with database instance or error response
 *
 * @example
 * const result = await getOrCreateCaptionDb(videoId)
 * if (!result.success) return result.response
 * const { db, created } = result
 */
export async function getOrCreateCaptionDb(
  videoId: string
): Promise<DatabaseResult & { created?: boolean }> {
  const { existsSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  // First check if video directory exists
  const videoDir = await getVideoDir(videoId)
  if (!videoDir) {
    return {
      success: false,
      response: notFoundResponse('Video not found'),
    }
  }

  const dbPath = await getCaptionsDbPath(videoId)
  const dbExists = dbPath !== null && existsSync(dbPath)

  // If dbPath is null but videoDir exists, we need to construct the path
  const actualDbPath = dbPath ?? `${videoDir}/captions.db`

  try {
    // Run migrations if database already exists
    if (dbExists) {
      migrateDatabase(actualDbPath)
    }

    const db = new Database(actualDbPath)
    // Enable WAL mode for better concurrent access
    // WAL allows reads to proceed while writes are happening
    db.pragma('journal_mode = WAL')

    // Return whether database was created (for callers that need to initialize schema)
    return {
      success: true,
      db,
      created: !dbExists,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open database'
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

// =============================================================================
// Layout Database Access Functions
// =============================================================================

/**
 * Get a read-only layout database connection for a video.
 *
 * Returns an error Response if the video or database doesn't exist.
 * The caller is responsible for closing the database when done.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @returns DatabaseResult with database instance or error response
 */
export async function getLayoutDb(videoId: string): Promise<DatabaseResult> {
  const { existsSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  const dbPath = await getLayoutDbPath(videoId)
  if (!dbPath) {
    return {
      success: false,
      response: notFoundResponse('Video not found'),
    }
  }

  if (!existsSync(dbPath)) {
    return {
      success: false,
      response: notFoundResponse(`Layout database not found for video: ${videoId}`),
    }
  }

  try {
    const db = new Database(dbPath, { readonly: true })
    db.pragma('journal_mode = WAL')
    return { success: true, db }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open layout database'
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

/**
 * Get a read-write layout database connection for a video.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @returns DatabaseResult with database instance or error response
 */
export async function getWritableLayoutDb(videoId: string): Promise<DatabaseResult> {
  const { existsSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  const dbPath = await getLayoutDbPath(videoId)
  if (!dbPath) {
    return {
      success: false,
      response: notFoundResponse('Video not found'),
    }
  }

  if (!existsSync(dbPath)) {
    return {
      success: false,
      response: notFoundResponse(`Layout database not found for video: ${videoId}`),
    }
  }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    return { success: true, db }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open layout database'
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

/**
 * Get or create a layout database for a video.
 *
 * Creates the database file and schema if it doesn't exist.
 * Includes database_metadata table for schema versioning.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @returns DatabaseResult with database instance or error response
 */
export async function getOrCreateLayoutDb(
  videoId: string
): Promise<DatabaseResult & { created?: boolean }> {
  const { existsSync } = await import('fs')
  const Database = (await import('better-sqlite3')).default

  const videoDir = await getVideoDir(videoId)
  if (!videoDir) {
    return {
      success: false,
      response: notFoundResponse('Video not found'),
    }
  }

  const dbPath = await getLayoutDbPath(videoId)
  const dbExists = dbPath !== null && existsSync(dbPath)
  const actualDbPath = dbPath ?? `${videoDir}/layout.db`

  try {
    const db = new Database(actualDbPath)
    db.pragma('journal_mode = WAL')

    // Create schema if database was just created
    if (!dbExists) {
      // Create database_metadata table
      db.exec(`
        CREATE TABLE IF NOT EXISTS database_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          migrated_at TEXT
        )
      `)
      db.exec(`
        INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1)
      `)

      // Create video_layout_config table
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_layout_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          frame_width INTEGER NOT NULL,
          frame_height INTEGER NOT NULL,
          crop_left INTEGER NOT NULL DEFAULT 0,
          crop_top INTEGER NOT NULL DEFAULT 0,
          crop_right INTEGER NOT NULL DEFAULT 0,
          crop_bottom INTEGER NOT NULL DEFAULT 0,
          selection_left INTEGER,
          selection_top INTEGER,
          selection_right INTEGER,
          selection_bottom INTEGER,
          selection_mode TEXT NOT NULL DEFAULT 'disabled',
          vertical_position REAL,
          vertical_std REAL,
          box_height REAL,
          box_height_std REAL,
          anchor_type TEXT,
          anchor_position REAL,
          top_edge_std REAL,
          bottom_edge_std REAL,
          horizontal_std_slope REAL,
          horizontal_std_intercept REAL,
          crop_bounds_version INTEGER NOT NULL DEFAULT 1,
          analysis_model_version TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)

      // Create full_frame_box_labels table
      db.exec(`
        CREATE TABLE IF NOT EXISTS full_frame_box_labels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          frame_index INTEGER NOT NULL,
          box_index INTEGER NOT NULL,
          label TEXT NOT NULL CHECK (label IN ('in', 'out')),
          label_source TEXT NOT NULL DEFAULT 'user' CHECK (label_source IN ('user', 'model')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(frame_index, box_index, label_source)
        )
      `)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_box_labels_frame ON full_frame_box_labels(frame_index)
      `)

      // Create box_classification_model table
      db.exec(`
        CREATE TABLE IF NOT EXISTS box_classification_model (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          model_data BLOB,
          model_version TEXT,
          trained_at TEXT
        )
      `)

      // Create video_preferences table
      db.exec(`
        CREATE TABLE IF NOT EXISTS video_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          layout_approved INTEGER NOT NULL DEFAULT 0
        )
      `)
    }

    return {
      success: true,
      db,
      created: !dbExists,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open layout database'
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

// =============================================================================
// Transaction Wrapper
// =============================================================================

/**
 * Execute a function within a database transaction.
 *
 * Provides automatic transaction management:
 * - Begins transaction before calling the function
 * - Commits on success
 * - Rolls back on error
 * - Always closes the database connection
 *
 * @param videoId - Video identifier (UUID or display path)
 * @param fn - Async function to execute with database access
 * @param options - Transaction options
 * @returns Response from the function or error response
 *
 * @example
 * return withDatabase(videoId, async (db) => {
 *   db.prepare('UPDATE ...').run(...)
 *   db.prepare('INSERT ...').run(...)
 *   return jsonResponse({ success: true })
 * })
 *
 * @example
 * // With read-only access (no transaction)
 * return withDatabase(videoId, async (db) => {
 *   const rows = db.prepare('SELECT ...').all()
 *   return jsonResponse({ data: rows })
 * }, { readonly: true })
 */
export async function withDatabase<T extends Response>(
  videoId: string,
  fn: (db: Database.Database) => Promise<T> | T,
  options: TransactionOptions = {}
): Promise<T | Response> {
  const { createIfMissing = false, readonly = false } = options

  // Get database connection
  let result: DatabaseResult & { created?: boolean }
  if (createIfMissing) {
    result = await getOrCreateCaptionDb(videoId)
  } else if (readonly) {
    result = await getCaptionDb(videoId)
  } else {
    result = await getWritableCaptionDb(videoId)
  }

  if (!result.success) {
    return result.response
  }

  const db = result.db

  // For read-only, just execute without transaction
  if (readonly) {
    try {
      return await fn(db)
    } catch (error) {
      console.error('Database error:', error)
      const message = error instanceof Error ? error.message : 'Database error'
      return errorResponse(message) as T
    } finally {
      db.close()
    }
  }

  // For read-write, use transaction
  try {
    db.prepare('BEGIN TRANSACTION').run()

    const response = await fn(db)

    db.prepare('COMMIT').run()
    return response
  } catch (error) {
    // Attempt rollback
    try {
      db.prepare('ROLLBACK').run()
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError)
    }

    console.error('Database transaction error:', error)
    const message = error instanceof Error ? error.message : 'Database error'
    return errorResponse(message) as T
  } finally {
    db.close()
  }
}

/**
 * Execute a function with database access (no transaction).
 *
 * Simpler version of withDatabase for cases where transaction
 * semantics aren't needed. Still handles errors and cleanup.
 *
 * @param videoId - Video identifier (UUID or display path)
 * @param fn - Async function to execute with database access
 * @param options - Database options
 * @returns Response from the function or error response
 *
 * @example
 * return withDatabaseNoTransaction(videoId, async (db) => {
 *   const row = db.prepare('SELECT ...').get()
 *   return jsonResponse({ data: row })
 * })
 */
export async function withDatabaseNoTransaction<T extends Response>(
  videoId: string,
  fn: (db: Database.Database) => Promise<T> | T,
  options: DatabaseOptions = {}
): Promise<T | Response> {
  const { readonly = false } = options

  const result = readonly ? await getCaptionDb(videoId) : await getWritableCaptionDb(videoId)

  if (!result.success) {
    return result.response
  }

  const db = result.db

  try {
    return await fn(db)
  } catch (error) {
    console.error('Database error:', error)
    const message = error instanceof Error ? error.message : 'Database error'
    return errorResponse(message) as T
  } finally {
    db.close()
  }
}

// =============================================================================
// Query Helpers
// =============================================================================

/**
 * Safe query execution with error handling.
 *
 * Wraps a query in try-catch and returns null on error instead of throwing.
 * Useful for optional queries where missing data is acceptable.
 *
 * @param db - Database instance
 * @param sql - SQL query string
 * @param params - Query parameters
 * @returns Query result or null on error
 *
 * @example
 * const config = safeGet<VideoLayoutConfig>(db, 'SELECT * FROM video_layout_config WHERE id = 1')
 * if (!config) {
 *   // Handle missing config
 * }
 */
export function safeGet<T>(db: Database.Database, sql: string, ...params: unknown[]): T | null {
  try {
    return (db.prepare(sql).get(...params) as T | undefined) ?? null
  } catch (error) {
    console.error('Query error:', error)
    return null
  }
}

/**
 * Safe query execution for arrays with error handling.
 *
 * @param db - Database instance
 * @param sql - SQL query string
 * @param params - Query parameters
 * @returns Query results or empty array on error
 */
export function safeAll<T>(db: Database.Database, sql: string, ...params: unknown[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[]
  } catch (error) {
    console.error('Query error:', error)
    return []
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

// Re-export video-paths functions that are commonly used with database utils
export { getCaptionsDbPath, getLayoutDbPath, getVideoDir } from '~/utils/video-paths'
