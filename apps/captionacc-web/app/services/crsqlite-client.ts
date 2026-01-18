/**
 * CR-SQLite Client
 *
 * Core wa-sqlite + CR-SQLite manager for browser-side database operations.
 * Provides type-safe SQL execution, version tracking, and change extraction/application.
 *
 * This is the foundation layer for the CR-SQLite sync infrastructure.
 */

import {
  wasmLoadError,
  crsqliteInitError,
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
  /** Primary key value(s) */
  pk: unknown[]
  /** Column-value pairs for the change */
  cid: string
  /** Value being set */
  val: unknown
  /** Column version */
  col_version: number
  /** Database version when change was made */
  db_version: number
  /** Site ID that made the change */
  site_id: Uint8Array
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
  /** Site ID for this client */
  siteId: Uint8Array
}

// =============================================================================
// WASM Module Types (from wa-sqlite and crsqlite-wasm)
// =============================================================================

/**
 * wa-sqlite API interface.
 * Minimal type definitions for the wa-sqlite API we use.
 */
interface SQLiteAPI {
  open_v2(filename: string, flags?: number, vfs?: string): Promise<number>
  close(db: number): Promise<number>
  exec(
    db: number,
    sql: string,
    callback?: (row: unknown[], columns: string[]) => void
  ): Promise<number>
  prepare_v2(db: number, sql: string): Promise<{ stmt: number; sql: string }>
  bind(stmt: number, params: unknown[]): Promise<number>
  step(stmt: number): Promise<number>
  column_count(stmt: number): number
  column_name(stmt: number, index: number): string
  column(stmt: number, index: number): unknown
  finalize(stmt: number): Promise<number>
  changes(db: number): number
}

/**
 * Virtual File System interface for wa-sqlite.
 */
interface SQLiteVFS {
  name: string
}

// =============================================================================
// Module State
// =============================================================================

/** SQLite3 instance from @vlcn.io/crsqlite-wasm */
let sqlite3Instance: any | null = null

/** Cached wa-sqlite API instance (for compatibility) */
let sqliteApi: SQLiteAPI | null = null

/** Cached VFS instance */
let sqliteVfs: SQLiteVFS | null = null

/** Promise for ongoing initialization */
let initPromise: Promise<void> | null = null

/** Track if CR-SQLite extension is loaded */
let crsqliteLoaded = false

// =============================================================================
// WASM Initialization
// =============================================================================

/**
 * Initialize wa-sqlite with CR-SQLite extension.
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
  if (sqliteApi && crsqliteLoaded) {
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
    sqlite3Instance = await initCRSQLite()

    // The API methods are in sqlite3Instance.base (for low-level access if needed)
    sqliteApi = sqlite3Instance.base as unknown as SQLiteAPI
    sqliteVfs = null

    console.log('[CRSQLite] wa-sqlite + CR-SQLite initialized successfully')

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
  return sqliteApi !== null && crsqliteLoaded
}

// =============================================================================
// Database Instance
// =============================================================================

/**
 * CRSQLite database instance.
 * Wraps a wa-sqlite database handle with CR-SQLite functionality.
 */
export class CRSQLiteDatabase {
  private db: number | null = null
  private dbInstance: any | null = null // The high-level DB instance from @vlcn.io/crsqlite-wasm
  private sqlJsDb: any | null = null // sql.js Database instance (used instead of CR-SQLite for now)
  private _siteId: Uint8Array | null = null
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
    // Ensure wa-sqlite is initialized
    await initializeSQLite()

    if (!sqlite3Instance || !sqliteApi) {
      throw databaseInitError(config.dbName, new Error('SQLite not initialized'))
    }

    const instance = new CRSQLiteDatabase(config)

    try {
      // Generate a unique filename for VFS storage
      // Note: IDBBatchAtomicVFS expects paths to start with '/'
      const filename = `/${config.videoId}_${config.dbName}.db`

      // Just use sql.js directly - no copying or CR-SQLite for now
      if (config.data && config.data.length > 0) {
        console.log(`[CRSQLite] Opening database with sql.js (${config.data.length} bytes)`)

        // Check if the data looks like a valid SQLite database
        const header = new TextDecoder().decode(config.data.slice(0, 16))
        if (!header.startsWith('SQLite format 3')) {
          throw new Error(`Invalid SQLite database header: ${header}`)
        }

        // Use sql.js to open the database directly
        console.log('[CRSQLite] Loading sql.js...')
        const initSqlJs = (await import('sql.js')).default
        const SQL = await initSqlJs({
          locateFile: (file: string) => `https://sql.js.org/dist/${file}`
        })

        // Open the database with sql.js and use it directly
        instance.sqlJsDb = new SQL.Database(config.data)
        instance.db = 1 // Dummy handle for compatibility
        console.log('[CRSQLite] Database opened with sql.js')

        // Log tables
        const tablesResult = instance.sqlJsDb.exec(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        if (tablesResult.length > 0 && tablesResult[0]) {
          const tables = tablesResult[0].values.flat()
          console.log('[CRSQLite] Tables:', tables)
          console.log('[CRSQLite] Table names:', JSON.stringify(tables))
        }
      } else {
        throw new Error('No database data provided')
      }

      // TODO: Enable CR-SQLite replication later
      // For now, just use the database without CR-SQLite to get basic functionality working
      // The schema needs to be adjusted (add DEFAULT values to NOT NULL columns) before CR-SQLite will work
      console.log('[CRSQLite] Database ready (CR-SQLite replication disabled for now)')

      // Initialize version and site ID
      await instance.initializeMetadata()

      // Register for GC tracking
      CRSQLiteDatabase.instances.set(instance.instanceId, new WeakRef(instance))
      CRSQLiteDatabase.cleanupRegistry.register(instance, instance.instanceId)

      console.log(`[CRSQLite] Database opened: ${instance.instanceId}`)
      return instance
    } catch (error) {
      // Clean up on failure
      if (instance.dbInstance) {
        try {
          await instance.dbInstance.close()
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
   * Initialize database metadata (version and site ID).
   */
  private async initializeMetadata(): Promise<void> {
    // For now, CR-SQLite replication is disabled
    // Just use default values instead of querying CR-SQLite metadata
    this._siteId = new Uint8Array(16)
    this._version = 0

    // TODO: Enable CR-SQLite and uncomment these queries once schema is compatible
    // Get or create site ID
    // const siteIdResult = await this.query<{ site_id: Uint8Array }>(
    //   'SELECT crsql_site_id() as site_id'
    // )
    // const siteIdRow = siteIdResult.rows[0]
    // if (siteIdRow) {
    //   this._siteId = siteIdRow.site_id
    // }

    // Get current version
    // const versionResult = await this.query<{ version: number }>(
    //   'SELECT crsql_db_version() as version'
    // )
    // const versionRow = versionResult.rows[0]
    // if (versionRow) {
    //   this._version = versionRow.version
    // }
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
  get siteId(): Uint8Array | null {
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

    // Use sql.js if available (temporary approach until CR-SQLite is re-enabled)
    if (this.sqlJsDb) {
      try {
        if (params && params.length > 0) {
          this.sqlJsDb.run(sql, params)
        } else {
          this.sqlJsDb.run(sql)
        }
        return this.sqlJsDb.getRowsModified()
      } catch (error) {
        const dbError = queryError(sql, error)
        logDatabaseError(dbError)
        throw dbError
      }
    }

    // CR-SQLite path (will be used once re-enabled)
    if (!sqliteApi || this.db === null) {
      throw queryError(sql, new Error('Database not initialized'))
    }

    try {
      if (params && params.length > 0) {
        // Use prepared statement for parameterized queries
        const prepared = await sqliteApi.prepare_v2(this.db, sql)
        try {
          await sqliteApi.bind(prepared.stmt, params)
          await sqliteApi.step(prepared.stmt)
          return sqliteApi.changes(this.db)
        } finally {
          await sqliteApi.finalize(prepared.stmt)
        }
      } else {
        // Direct execution for simple queries
        await sqliteApi.exec(this.db, sql)
        return sqliteApi.changes(this.db)
      }
    } catch (error) {
      const dbError = queryError(sql, error)
      logDatabaseError(dbError)
      throw dbError
    }
  }

  /**
   * Helper to build a row object from a prepared statement.
   * Extracted to reduce nesting depth in query().
   */
  private buildRowFromStatement(
    sqliteApi: SQLiteAPI,
    stmt: number,
    columns: string[],
    columnCount: number
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {}
    for (let i = 0; i < columnCount; i++) {
      const colName = columns[i]
      if (colName !== undefined) {
        row[colName] = sqliteApi.column(stmt, i)
      }
    }
    return row
  }

  /**
   * Execute a SQL query and return results.
   *
   * @param sql SQL query
   * @param params Optional parameters
   * @returns Query result with columns and rows
   * @throws DatabaseError if query fails
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.ensureOpen()

    // Use sql.js if available (temporary approach until CR-SQLite is re-enabled)
    if (this.sqlJsDb) {
      try {
        console.log(`[CRSQLite] Executing query: ${sql.substring(0, 100)}...`)
        let results
        if (params && params.length > 0) {
          // For parameterized queries with sql.js, we need to use prepare/bind/step manually
          const stmt = this.sqlJsDb.prepare(sql)
          stmt.bind(params)

          const columns: string[] = stmt.getColumnNames()
          const rows: T[] = []

          while (stmt.step()) {
            const rowArray = stmt.get()
            const row: Record<string, unknown> = {}
            for (let i = 0; i < columns.length; i++) {
              const colName = columns[i]
              if (colName !== undefined) {
                row[colName] = rowArray[i]
              }
            }
            rows.push(row as T)
          }
          stmt.free()

          return { columns, rows }
        } else {
          // For simple queries, use exec
          results = this.sqlJsDb.exec(sql)

          if (results.length === 0) {
            return { columns: [], rows: [] }
          }

          const result = results[0]
          const columns = result.columns
          const rows: T[] = result.values.map((rowArray: unknown[]) => {
            const row: Record<string, unknown> = {}
            for (let i = 0; i < columns.length; i++) {
              const colName = columns[i]
              if (colName !== undefined) {
                row[colName] = rowArray[i]
              }
            }
            return row as T
          })

          return { columns, rows }
        }
      } catch (error) {
        console.error('[CRSQLite] SQL.js query error:', error)
        console.error('[CRSQLite] Error message:', (error as Error).message)
        console.error('[CRSQLite] Query was:', sql.substring(0, 200))
        const dbError = queryError(sql, error)
        logDatabaseError(dbError)
        throw dbError
      }
    }

    // CR-SQLite path (will be used once re-enabled)
    if (!sqliteApi || this.db === null) {
      throw queryError(sql, new Error('Database not initialized'))
    }

    try {
      const columns: string[] = []
      const rows: T[] = []

      if (params && params.length > 0) {
        // Use prepared statement for parameterized queries
        const prepared = await sqliteApi.prepare_v2(this.db, sql)
        try {
          await sqliteApi.bind(prepared.stmt, params)

          // Get column names
          const columnCount = sqliteApi.column_count(prepared.stmt)
          for (let i = 0; i < columnCount; i++) {
            columns.push(sqliteApi.column_name(prepared.stmt, i))
          }

          // Fetch rows
          // SQLITE_ROW = 100
          while ((await sqliteApi.step(prepared.stmt)) === 100) {
            const row = this.buildRowFromStatement(sqliteApi, prepared.stmt, columns, columnCount)
            rows.push(row as T)
          }
        } finally {
          await sqliteApi.finalize(prepared.stmt)
        }
      } else {
        // Direct execution with callback
        await sqliteApi.exec(this.db, sql, (rowData, colNames) => {
          if (columns.length === 0) {
            columns.push(...colNames)
          }
          const row: Record<string, unknown> = {}
          for (let i = 0; i < colNames.length; i++) {
            const colName = colNames[i]
            if (colName !== undefined) {
              row[colName] = rowData[i]
            }
          }
          rows.push(row as T)
        })
      }

      return { columns, rows }
    } catch (error) {
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
    const result = await this.query<CRSQLiteChange>(
      `SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq
       FROM crsql_changes
       WHERE db_version > ?
       ORDER BY db_version, seq`,
      [sinceVersion]
    )
    return result.rows
  }

  /**
   * Apply changes from the server.
   * Used for syncing server changes to the local database.
   *
   * @param changes Changes to apply
   * @returns New database version after applying changes
   */
  async applyChanges(changes: CRSQLiteChange[]): Promise<number> {
    if (changes.length === 0) {
      return this._version
    }

    await this.exec('BEGIN TRANSACTION')

    try {
      for (const change of changes) {
        await this.exec(
          `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            change.table,
            JSON.stringify(change.pk),
            change.cid,
            change.val,
            change.col_version,
            change.db_version,
            change.site_id,
            change.cl,
            change.seq,
          ]
        )
      }

      await this.exec('COMMIT')

      // Update local version
      await this.initializeMetadata()

      console.log(`[CRSQLite] Applied ${changes.length} changes, new version: ${this._version}`)
      return this._version
    } catch (error) {
      await this.exec('ROLLBACK')
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
      siteId: this._siteId ?? new Uint8Array(16),
    }
  }

  /**
   * Close the database and release resources.
   */
  async close(): Promise<void> {
    if (this.closed || this.db === null) {
      return
    }

    try {
      // TODO: Finalize CR-SQLite when replication is enabled
      // await this.exec('SELECT crsql_finalize()')

      // Close sql.js database if present
      if (this.sqlJsDb) {
        this.sqlJsDb.close()
        this.sqlJsDb = null
      }

      // Close CR-SQLite database
      if (this.dbInstance) {
        await this.dbInstance.close()
      }

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
    if (this.closed || this.db === null) {
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
