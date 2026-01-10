/**
 * Database access utilities for annotation API routes.
 *
 * This module provides standardized database access patterns including:
 * - Read-only database access for queries (downloads from Wasabi)
 * - Read-write access with upload back to Wasabi
 * - Transaction wrappers with automatic rollback on error
 *
 * All functions return Response objects on error (not throw) to allow
 * clean early returns in route handlers.
 *
 * Architecture:
 * - Databases are stored in Wasabi S3: {tenant_id}/{video_id}/{db_name}
 * - Downloaded to local cache for processing
 * - Uploaded back to Wasabi after modifications
 */

import Database from 'better-sqlite3'

import { migrateDatabase } from '~/db/migrate'
import { notFoundResponse, errorResponse } from '~/utils/api-responses'
import {
  downloadDatabase,
  uploadDatabase,
  fileExistsInWasabi,
  buildStorageKey,
  getCachePath,
} from '~/services/wasabi-client'
import { createServerSupabaseClient } from '~/services/supabase-client'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Result type for database access functions.
 * Either contains the database instance or a Response for the error case.
 */
export type DatabaseResult =
  | { success: true; db: Database.Database; tenantId: string; videoId: string }
  | { success: false; response: Response }

/**
 * Options for database access functions.
 */
export interface DatabaseOptions {
  /** Open in read-only mode (default: false for getAnnotationDatabase, ignored for getOrCreate) */
  readonly?: boolean
  /** Database name to use (default: 'fullOCR.db' for layout annotation) */
  dbName?: 'video.db' | 'fullOCR.db' | 'layout.db' | 'captions.db'
}

/**
 * Options for transaction wrapper.
 */
export interface TransactionOptions {
  /** Whether to create the database if it doesn't exist (default: false) */
  createIfMissing?: boolean
  /** Open in read-only mode - incompatible with createIfMissing (default: false) */
  readonly?: boolean
  /** Database name to use */
  dbName?: 'video.db' | 'fullOCR.db' | 'layout.db' | 'captions.db'
}

// Default tenant for development
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Get the tenant ID for a video from Supabase
 */
async function getTenantIdForVideo(videoId: string): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient()
    const { data, error } = await supabase
      .from('videos')
      .select('tenant_id')
      .eq('id', videoId)
      .single()

    if (error || !data) {
      console.log(`[Database] Video ${videoId} not found in Supabase`)
      return null
    }

    return data.tenant_id
  } catch (error) {
    console.error(`[Database] Error fetching tenant for video ${videoId}:`, error)
    return null
  }
}

// =============================================================================
// Database Access Functions
// =============================================================================

/**
 * Get a read-only database connection for a video.
 * Downloads the database from Wasabi if not cached locally.
 *
 * @param videoId - Video UUID
 * @param options - Database options
 * @returns DatabaseResult with database instance or error response
 */
export async function getAnnotationDatabase(
  videoId: string,
  options: DatabaseOptions = {}
): Promise<DatabaseResult> {
  const { dbName = 'fullOCR.db' } = options

  // Get tenant ID from Supabase
  const tenantId = (await getTenantIdForVideo(videoId)) ?? DEFAULT_TENANT_ID

  // Check if database exists in Wasabi
  const storageKey = buildStorageKey(tenantId, videoId, dbName)
  const exists = await fileExistsInWasabi(storageKey)

  if (!exists) {
    return {
      success: false,
      response: notFoundResponse(`Database ${dbName} not found for video: ${videoId}`),
    }
  }

  try {
    // Download database from Wasabi
    const localPath = await downloadDatabase(tenantId, videoId, dbName)

    const db = new Database(localPath, { readonly: true })
    db.pragma('journal_mode = WAL')

    return { success: true, db, tenantId, videoId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open database'
    console.error(`[Database] Error opening ${dbName} for ${videoId}:`, error)
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

/**
 * Get a read-write database connection for a video.
 * Downloads from Wasabi, allows modifications, and uploads back when closed.
 *
 * @param videoId - Video UUID
 * @param options - Database options
 * @returns DatabaseResult with database instance or error response
 */
export async function getWritableDatabase(
  videoId: string,
  options: DatabaseOptions = {}
): Promise<DatabaseResult> {
  const { dbName = 'fullOCR.db' } = options

  // Get tenant ID from Supabase
  const tenantId = (await getTenantIdForVideo(videoId)) ?? DEFAULT_TENANT_ID

  // Check if database exists in Wasabi
  const storageKey = buildStorageKey(tenantId, videoId, dbName)
  const exists = await fileExistsInWasabi(storageKey)

  if (!exists) {
    return {
      success: false,
      response: notFoundResponse(`Database ${dbName} not found for video: ${videoId}`),
    }
  }

  try {
    // Download database from Wasabi (force refresh to get latest)
    const localPath = await downloadDatabase(tenantId, videoId, dbName, true)

    // Run migrations
    migrateDatabase(localPath)

    const db = new Database(localPath)
    db.pragma('journal_mode = WAL')

    return { success: true, db, tenantId, videoId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open database'
    console.error(`[Database] Error opening writable ${dbName} for ${videoId}:`, error)
    return {
      success: false,
      response: errorResponse(message),
    }
  }
}

/**
 * Upload a modified database back to Wasabi.
 * Call this after making changes to a writable database.
 */
export async function syncDatabaseToWasabi(
  tenantId: string,
  videoId: string,
  dbName: 'video.db' | 'fullOCR.db' | 'layout.db' | 'captions.db'
): Promise<void> {
  await uploadDatabase(tenantId, videoId, dbName)
}

/**
 * @deprecated Use getWritableDatabase instead.
 * Database creation is now handled by the orchestrator service.
 */
export async function getOrCreateAnnotationDatabase(
  videoId: string
): Promise<DatabaseResult & { created?: boolean }> {
  // Delegate to getWritableDatabase - creation is now handled by orchestrator
  const result = await getWritableDatabase(videoId)
  return { ...result, created: false }
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
  const { createIfMissing = false, readonly = false, dbName = 'fullOCR.db' } = options

  // Get database connection
  let result: DatabaseResult
  if (createIfMissing) {
    result = await getOrCreateAnnotationDatabase(videoId)
  } else if (readonly) {
    result = await getAnnotationDatabase(videoId, { dbName })
  } else {
    result = await getWritableDatabase(videoId, { dbName })
  }

  if (!result.success) {
    return result.response
  }

  const { db, tenantId } = result

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

  // For read-write, use transaction and sync to Wasabi after
  let shouldSync = false
  try {
    db.prepare('BEGIN TRANSACTION').run()

    const response = await fn(db)

    db.prepare('COMMIT').run()
    shouldSync = true

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
    // Sync changes to Wasabi if transaction succeeded
    if (shouldSync) {
      try {
        await syncDatabaseToWasabi(tenantId, videoId, dbName)
      } catch (syncError) {
        console.error('Failed to sync database to Wasabi:', syncError)
      }
    }
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
  const { readonly = false, dbName = 'fullOCR.db' } = options

  const result = readonly
    ? await getAnnotationDatabase(videoId, { dbName })
    : await getWritableDatabase(videoId, { dbName })

  if (!result.success) {
    return result.response
  }

  const { db, tenantId } = result

  try {
    const response = await fn(db)
    // Sync changes if not readonly
    if (!readonly) {
      db.close()
      await syncDatabaseToWasabi(tenantId, videoId, dbName)
    } else {
      db.close()
    }
    return response
  } catch (error) {
    console.error('Database error:', error)
    const message = error instanceof Error ? error.message : 'Database error'
    db.close()
    return errorResponse(message) as T
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

// Re-export Wasabi functions that are commonly used with database utils
export { buildStorageKey, getCachePath, fileExistsInWasabi } from '~/services/wasabi-client'
