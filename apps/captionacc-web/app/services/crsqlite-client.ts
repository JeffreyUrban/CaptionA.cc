/**
 * CR-SQLite Client
 *
 * Core @vlcn.io/crsqlite-wasm manager for browser-side database operations.
 * Provides type-safe SQL execution, version tracking, and change extraction/application.
 *
 * This is the foundation layer for the CR-SQLite sync infrastructure.
 */

import {
  wasmLoadError,
  databaseInitError,
  queryError,
  toDatabaseError,
  logDatabaseError,
} from './database-errors'

import type { DatabaseName } from '~/config'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * CR-SQLite change record for sync operations.
 * Represents a single change that can be applied to synchronize databases.
 */
export interface CRSQLiteChange {
  /** Table name */
  table: string
  /** Primary key value(s) - base64 encoded */
  pk: string
  /** Column name for the change */
  cid: string
  /** Value being set */
  val: unknown
  /** Column version */
  col_version: number
  /** Database version when change was made */
  db_version: number
  /** Site ID that made the change - base64 encoded */
  site_id: string
  /** Causal length for ordering */
  cl: number
  /** Sequence number */
  seq: number
}

/**
 * Result of a SQL query.
 */
export interface QueryResult<T = unknown> {
  /** Column names */
  columns: string[]
  /** Row data */
  rows: T[]
}

/**
 * Database instance configuration.
 */
export interface DatabaseConfig {
  /** Video ID this database belongs to */
  videoId: string
  /** Database name (layout or captions) */
  dbName: DatabaseName
  /** Initial database bytes (from download) */
  data?: Uint8Array
}

/**
 * Database version information.
 */
export interface DatabaseVersion {
  /** Current database version */
  version: number
  /** Site ID for this client (base64 encoded) */
  siteId: string
}

// =============================================================================
// Type Definitions for @vlcn.io/crsqlite-wasm
// =============================================================================

/**
 * DB interface from @vlcn.io/crsqlite-wasm
 * Note: All exec methods return Promises in @vlcn.io/crsqlite-wasm
 */
interface CRSQLiteDB {
  execO<T extends object>(sql: string, bind?: unknown[]): Promise<T[]>
  execA<T extends unknown[]>(sql: string, bind?: unknown[]): Promise<T[]>
  exec(sql: string, bind?: unknown[]): Promise<void>
  close(): void
  onUpdate(
    cb: (updateType: number, dbName: string | null, tblName: string | null, rowid: bigint) => void
  ): () => void
}

/**
 * SQLite3 interface from @vlcn.io/crsqlite-wasm
 */
interface CRSQLite3 {
  open(filename?: string, mode?: string): Promise<CRSQLiteDB>
}

// =============================================================================
// Module State
// =============================================================================

/** SQLite3 instance from @vlcn.io/crsqlite-wasm */
let sqlite3Instance: CRSQLite3 | null = null

/** Promise for ongoing initialization */
let initPromise: Promise<void> | null = null

/** Track if CR-SQLite extension is loaded */
let crsqliteLoaded = false

// =============================================================================
// WASM Initialization
// =============================================================================

/**
 * Initialize @vlcn.io/crsqlite-wasm.
 * This should be called once before any database operations.
 *
 * @throws DatabaseError if initialization fails
 */
export async function initializeSQLite(): Promise<void> {
  // Return cached promise if already initializing
  if (initPromise) {
    return initPromise
  }

  // Already initialized
  if (sqlite3Instance && crsqliteLoaded) {
    return
  }

  initPromise = doInitialize()
  try {
    await initPromise
  } catch (error) {
    initPromise = null
    throw error
  }
}

async function doInitialize(): Promise<void> {
  try {
    // Dynamic import of @vlcn.io/crsqlite-wasm
    const crsqliteModule = await import('@vlcn.io/crsqlite-wasm')
    const initCRSQLite = crsqliteModule.default

    // Initialize CR-SQLite WASM module - returns SQLite3 instance
    sqlite3Instance = (await initCRSQLite()) as CRSQLite3

    console.log('[CRSQLite] @vlcn.io/crsqlite-wasm initialized successfully')

    // CR-SQLite extension is already loaded by @vlcn.io/crsqlite-wasm
    crsqliteLoaded = true
    console.log('[CRSQLite] CR-SQLite extension ready')
  } catch (error) {
    console.error('[CRSQLite] Initialization failed:', error)
    const dbError = wasmLoadError(error)
    logDatabaseError(dbError)
    throw dbError
  }
}

/**
 * Check if wa-sqlite is initialized.
 */
export function isSQLiteInitialized(): boolean {
  return sqlite3Instance !== null && crsqliteLoaded
}

// =============================================================================
// Database Instance
// =============================================================================

/**
 * CRSQLite database instance.
 * Wraps a @vlcn.io/crsqlite-wasm database with CR-SQLite functionality.
 */
export class CRSQLiteDatabase {
  private db: CRSQLiteDB | null = null
  private _siteId: string | null = null
  private _version: number = 0
  private closed = false

  readonly videoId: string
  readonly dbName: DatabaseName
  readonly instanceId: string

  /**
   * WeakRef tracking for garbage collection awareness.
   * Used by the database store to clean up abandoned instances.
   */
  private static instances = new Map<string, WeakRef<CRSQLiteDatabase>>()
  private static cleanupRegistry = new FinalizationRegistry<string>(instanceId => {
    CRSQLiteDatabase.instances.delete(instanceId)
    console.log(`[CRSQLite] Database instance ${instanceId} garbage collected`)
  })

  private constructor(config: DatabaseConfig) {
    this.videoId = config.videoId
    this.dbName = config.dbName
    this.instanceId = `${config.videoId}:${config.dbName}`
  }

  /**
   * Open a new database instance.
   *
   * @param config Database configuration
   * @returns Initialized database instance
   * @throws DatabaseError if opening fails
   */
  static async open(config: DatabaseConfig): Promise<CRSQLiteDatabase> {
    // Ensure crsqlite-wasm is initialized
    await initializeSQLite()

    if (!sqlite3Instance) {
      throw databaseInitError(config.dbName, new Error('SQLite not initialized'))
    }

    const instance = new CRSQLiteDatabase(config)

    try {
      if (!config.data || config.data.length === 0) {
        throw new Error('No database data provided')
      }

      // Validate SQLite header
      const header = new TextDecoder().decode(config.data.slice(0, 16))
      if (!header.startsWith('SQLite format 3')) {
        throw new Error(`Invalid SQLite database header: ${header}`)
      }

      console.log(`[CRSQLite] Opening database (${config.data.length} bytes)`)

      // Open a true in-memory database by passing undefined
      // This avoids the IndexedDB VFS which causes issues
      // Note: Each instance gets its own in-memory database
      console.log('[CRSQLite] Calling sqlite3Instance.open()...')
      try {
        instance.db = await sqlite3Instance.open()
        console.log('[CRSQLite] sqlite3Instance.open() succeeded')
      } catch (openError) {
        console.error('[CRSQLite] sqlite3Instance.open() failed:', openError)
        throw openError
      }

      // Import the database bytes using SQLite's deserialize
      // We need to use the low-level approach since we're loading from bytes
      // For now, we'll reconstruct the database by executing the schema and data
      // This is a workaround until we find a better bytes import method

      // Actually, let's try a different approach - use the VFS to write the bytes
      // For @vlcn.io/crsqlite-wasm, we can use the underlying wa-sqlite mechanisms

      // Alternative: Use sql.js to read the schema and data, then recreate in crsqlite
      // This is temporary until we find the proper bytes import API
      console.log('[CRSQLite] Initializing sql.js...')
      const initSqlJs = (await import('sql.js')).default
      const SQL = await initSqlJs({
        locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
      })
      console.log('[CRSQLite] sql.js initialized')

      // Open the source database with sql.js to extract schema and data
      console.log('[CRSQLite] Opening source database with sql.js...')
      const sourceDb = new SQL.Database(config.data)
      console.log('[CRSQLite] Source database opened')

      // Get all table schemas
      console.log('[CRSQLite] Getting table schemas...')
      const tablesResult = sourceDb.exec(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      console.log(
        '[CRSQLite] Found tables:',
        tablesResult.length > 0 ? tablesResult[0]?.values.map(r => r[0]) : 'none'
      )

      if (tablesResult.length > 0 && tablesResult[0]) {
        for (const row of tablesResult[0].values) {
          const tableName = row[0] as string
          const createSql = row[1] as string

          if (createSql) {
            // Create the table in the new database
            console.log(`[CRSQLite] Creating table: ${tableName}`)
            try {
              await instance.db.exec(createSql)
            } catch (tableError) {
              console.error(`[CRSQLite] Failed to create table ${tableName}:`, tableError)
              throw tableError
            }

            // Copy data from source to destination
            console.log(`[CRSQLite] Copying data for table: ${tableName}`)
            const dataResult = sourceDb.exec(`SELECT * FROM "${tableName}"`)
            if (dataResult.length > 0 && dataResult[0] && dataResult[0].values.length > 0) {
              const columns = dataResult[0].columns
              const rowCount = dataResult[0].values.length
              console.log(`[CRSQLite] Copying ${rowCount} rows for ${tableName}`)
              const placeholders = columns.map(() => '?').join(', ')
              const insertSql = `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`

              for (const dataRow of dataResult[0].values) {
                try {
                  await instance.db.exec(insertSql, dataRow as unknown[])
                } catch (insertError) {
                  console.error(
                    `[CRSQLite] Failed to insert row into ${tableName}:`,
                    insertError,
                    dataRow
                  )
                  throw insertError
                }
              }
              console.log(`[CRSQLite] Copied ${rowCount} rows for ${tableName}`)
            } else {
              console.log(`[CRSQLite] No data to copy for ${tableName}`)
            }
          }
        }
      }

      // Close the source database
      console.log('[CRSQLite] Closing source sql.js database')
      sourceDb.close()

      // Log tables
      console.log('[CRSQLite] Listing created tables...')
      const tables = await instance.db.execO<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      console.log(
        '[CRSQLite] Tables:',
        tables.map(t => t.name)
      )

      // Initialize CRR tables (idempotent - safe to call if already done)
      console.log('[CRSQLite] Initializing CRR tables...')
      await instance.ensureCrrInitialized()
      console.log('[CRSQLite] CRR tables initialized')

      // Initialize version and site ID
      console.log('[CRSQLite] Initializing metadata...')
      await instance.initializeMetadata()
      console.log('[CRSQLite] Metadata initialized')

      // Register for GC tracking
      CRSQLiteDatabase.instances.set(instance.instanceId, new WeakRef(instance))
      CRSQLiteDatabase.cleanupRegistry.register(instance, instance.instanceId)

      console.log(`[CRSQLite] Database opened: ${instance.instanceId}`)
      return instance
    } catch (error) {
      // Log the actual error details
      console.error('[CRSQLite] Database open failed with error:', error)
      if (error instanceof Error) {
        console.error('[CRSQLite] Error message:', error.message)
        console.error('[CRSQLite] Error stack:', error.stack)
      }

      // Clean up on failure
      if (instance.db) {
        try {
          instance.db.close()
        } catch {
          // Ignore cleanup errors
        }
      }

      const dbError = databaseInitError(config.dbName, error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Get an existing database instance by ID.
   */
  static getInstance(instanceId: string): CRSQLiteDatabase | undefined {
    const ref = CRSQLiteDatabase.instances.get(instanceId)
    return ref?.deref()
  }

  /**
   * Ensure CRR tables are initialized.
   * The data pipeline creates databases without CR-SQLite, so we initialize lazily.
   */
  private async ensureCrrInitialized(): Promise<void> {
    if (!this.db) return

    try {
      // Check if crsql_changes exists (indicates CRR already initialized)
      await this.db.execO('SELECT 1 FROM crsql_changes LIMIT 1')
    } catch {
      // crsql_changes doesn't exist - initialize CRRs
      if (this.dbName === 'layout') {
        await this.db.exec("SELECT crsql_as_crr('boxes')")
        await this.db.exec("SELECT crsql_as_crr('layout_config')")
        await this.db.exec("SELECT crsql_as_crr('preferences')")
        console.log('[CRSQLite] Initialized CRR tables for layout')
      } else if (this.dbName === 'captions') {
        await this.db.exec("SELECT crsql_as_crr('captions')")
        console.log('[CRSQLite] Initialized CRR tables for captions')
      }
    }
  }

  /**
   * Initialize database metadata (version and site ID).
   */
  private async initializeMetadata(): Promise<void> {
    if (!this.db) return

    try {
      // Get site ID
      const siteIdResult = await this.db.execA<[Uint8Array]>('SELECT crsql_site_id()')
      if (siteIdResult.length > 0 && siteIdResult[0]) {
        // Convert Uint8Array to base64 string for easier handling
        const siteIdBytes = siteIdResult[0][0]
        this._siteId = this.uint8ArrayToBase64(siteIdBytes)
      }

      // Get current version
      const versionResult = await this.db.execA<[number]>('SELECT crsql_db_version()')
      if (versionResult.length > 0 && versionResult[0]) {
        this._version = versionResult[0][0]
      }

      console.log(
        `[CRSQLite] Metadata: version=${this._version}, siteId=${this._siteId?.slice(0, 8)}...`
      )
    } catch (error) {
      console.warn('[CRSQLite] Failed to get CR-SQLite metadata:', error)
      // Use defaults if CR-SQLite functions fail
      this._siteId = this.uint8ArrayToBase64(new Uint8Array(16))
      this._version = 0
    }
  }

  /**
   * Convert Uint8Array to base64 string.
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!)
    }
    return btoa(binary)
  }

  /**
   * Convert base64 string to Uint8Array.
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  /**
   * Get the current database version.
   */
  get version(): number {
    return this._version
  }

  /**
   * Get the site ID for this database instance.
   */
  get siteId(): string | null {
    return this._siteId
  }

  /**
   * Check if the database is closed.
   */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Execute a SQL statement without returning results.
   *
   * @param sql SQL statement
   * @param params Optional parameters
   * @returns Number of rows affected
   * @throws DatabaseError if execution fails
   */
  async exec(sql: string, params?: unknown[]): Promise<number> {
    this.ensureOpen()

    try {
      await this.db!.exec(sql, params)
      // Query changes() to get actual rows affected
      const result = await this.db!.execA('SELECT changes()')
      return (result[0]?.[0] as number) ?? 0
    } catch (error) {
      const dbError = queryError(sql, error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Execute a SQL query and return results.
   *
   * @param sql SQL query
   * @param params Optional parameters
   * @returns Query result with columns and rows
   * @throws DatabaseError if query fails
   */
  async query<T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.ensureOpen()

    try {
      const rows = await this.db!.execO<T>(sql, params)

      // Extract column names from first row, or empty if no results
      const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []

      return { columns, rows }
    } catch (error) {
      console.error('[CRSQLite] Query error:', error)
      console.error('[CRSQLite] Query was:', sql.substring(0, 200))
      const dbError = queryError(sql, error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Get changes since a specific version.
   * Used for syncing local changes to the server.
   *
   * @param sinceVersion Version to get changes since
   * @returns Array of changes
   */
  async getChangesSince(sinceVersion: number): Promise<CRSQLiteChange[]> {
    this.ensureOpen()

    const rows = await this.db!.execO<{
      table: string
      pk: Uint8Array
      cid: string
      val: unknown
      col_version: number
      db_version: number
      site_id: Uint8Array
      cl: number
      seq: number
    }>(
      `SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq
       FROM crsql_changes
       WHERE db_version > ?
       ORDER BY db_version, seq`,
      [sinceVersion]
    )

    // Convert binary fields to base64 for JSON serialization
    return rows.map(row => ({
      table: row.table,
      pk: this.uint8ArrayToBase64(row.pk),
      cid: row.cid,
      val: row.val,
      col_version: row.col_version,
      db_version: row.db_version,
      site_id: this.uint8ArrayToBase64(row.site_id),
      cl: row.cl,
      seq: row.seq,
    }))
  }

  /**
   * Apply changes from the server.
   * Used for syncing server changes to the local database.
   *
   * @param changes Changes to apply
   * @returns New database version after applying changes
   */
  async applyChanges(changes: CRSQLiteChange[]): Promise<number> {
    this.ensureOpen()

    if (changes.length === 0) {
      return this._version
    }

    try {
      await this.db!.exec('BEGIN TRANSACTION')

      for (const change of changes) {
        // Convert base64 back to Uint8Array for binary fields
        const pkBytes = this.base64ToUint8Array(change.pk)
        const siteIdBytes = this.base64ToUint8Array(change.site_id)

        await this.db!.exec(
          `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            change.table,
            pkBytes,
            change.cid,
            change.val,
            change.col_version,
            change.db_version,
            siteIdBytes,
            change.cl,
            change.seq,
          ]
        )
      }

      await this.db!.exec('COMMIT')

      // Update local version
      await this.initializeMetadata()

      console.log(`[CRSQLite] Applied ${changes.length} changes, new version: ${this._version}`)
      return this._version
    } catch (error) {
      try {
        await this.db!.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors
      }
      throw error
    }
  }

  /**
   * Get the current database version info.
   */
  async getVersionInfo(): Promise<DatabaseVersion> {
    await this.initializeMetadata()
    return {
      version: this._version,
      siteId: this._siteId ?? this.uint8ArrayToBase64(new Uint8Array(16)),
    }
  }

  /**
   * Close the database and release resources.
   */
  async close(): Promise<void> {
    if (this.closed || !this.db) {
      return
    }

    try {
      // Finalize CR-SQLite before closing
      try {
        await this.db.exec('SELECT crsql_finalize()')
      } catch {
        // May fail if extension not loaded properly
      }

      this.db.close()
      this.db = null
      this.closed = true
      CRSQLiteDatabase.instances.delete(this.instanceId)

      console.log(`[CRSQLite] Database closed: ${this.instanceId}`)
    } catch (error) {
      const dbError = toDatabaseError(error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Ensure the database is open before operations.
   */
  private ensureOpen(): void {
    if (this.closed || !this.db) {
      throw databaseInitError(this.dbName, new Error('Database is closed'))
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a unique instance ID for a database.
 */
export function createInstanceId(videoId: string, dbName: DatabaseName): string {
  return `${videoId}:${dbName}`
}

/**
 * Parse an instance ID back to its components.
 */
export function parseInstanceId(
  instanceId: string
): { videoId: string; dbName: DatabaseName } | null {
  const parts = instanceId.split(':')
  if (parts.length !== 2) {
    return null
  }
  const videoId = parts[0]
  const dbName = parts[1]
  if (videoId === undefined || dbName === undefined) {
    return null
  }
  return {
    videoId,
    dbName: dbName as DatabaseName,
  }
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Close all open database instances.
 * Should be called when the application is shutting down.
 */
export async function closeAllDatabases(): Promise<void> {
  const instances = Array.from(CRSQLiteDatabase['instances'].values())
  const closePromises: Promise<void>[] = []

  for (const ref of instances) {
    const db = ref.deref()
    if (db && !db.isClosed) {
      closePromises.push(db.close())
    }
  }

  await Promise.all(closePromises)
  console.log('[CRSQLite] All databases closed')
}
