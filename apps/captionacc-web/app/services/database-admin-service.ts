/**
 * Database administration service
 *
 * Provides observability and control over database versioning across all video databases.
 * Phase 1: Basic synchronous status queries
 *
 * Verification approach:
 * - Parse canonical schema file to get expected structure
 * - Query actual schema using PRAGMA table_info
 * - Compare tables and columns to detect drift
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'

import { getSchemaPath } from '~/db/schema-loader'
import { parseSchemaNames, type TableSchemaNames } from '~/utils/schema-parser'

const LOCAL_DATA_DIR = process.env['LOCAL_DATA_DIR'] ?? '../../local/processing'

// Get __dirname for path resolution
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface DatabaseInfo {
  videoId: string
  displayPath: string | null
  version: number
  versionLabel: string // Human-readable version (e.g., "v1", "latest (2026-01-03)")
  status: 'valid' | 'incomplete' | 'drift' | 'unversioned'
  tableCount: number
  lastVerified: string | null
}

export interface StatusSummary {
  total: number
  byVersion: Record<number, number>
  health: {
    valid: number
    incomplete: number
    drift: number
    unversioned: number
    failed: number
  }
  lastScan: string
}

export interface DetailedStatus {
  summary: StatusSummary
  databases: DatabaseInfo[]
}

/**
 * Find all annotations.db files recursively
 */
function findAllDatabases(): string[] {
  const databases: string[] = []

  function scanDir(dir: string) {
    try {
      const entries = readdirSync(dir)

      for (const entry of entries) {
        const fullPath = join(dir, entry)
        try {
          const stat = statSync(fullPath)

          if (stat.isDirectory()) {
            scanDir(fullPath)
          } else if (entry === 'annotations.db' && stat.size > 0) {
            databases.push(fullPath)
          }
        } catch {
          // Skip files/dirs we can't access
        }
      }
    } catch {
      // Skip directories we can't access
    }
  }

  scanDir(LOCAL_DATA_DIR)
  return databases
}

/**
 * Extract video ID from database path
 * Path format: .../local/processing/{hash}/{uuid}/annotations.db
 */
function extractVideoId(dbPath: string): string {
  const parts = dbPath.split('/')
  // Find the UUID part (second-to-last directory before annotations.db)
  const uuidIndex = parts.length - 2
  return parts[uuidIndex] ?? 'unknown'
}

/**
 * Get schema file path for specific version
 * Uses centralized schema-loader for consistent path resolution
 */
function getSchemaPathForVersion(version: number): string {
  const schemaDir = join(__dirname, '../db')
  return getSchemaPath(version, schemaDir)
}

/**
 * Get expected schema for specific version
 */
function getExpectedSchema(version: number): Map<string, TableSchemaNames> {
  const schemaPath = getSchemaPathForVersion(version)
  const schemaSQL = readFileSync(schemaPath, 'utf-8')
  return parseSchemaNames(schemaSQL)
}

/**
 * Get expected tables from schema for specific version
 */
function getExpectedTableCount(version: number): number {
  return getExpectedSchema(version).size
}

/**
 * Get actual columns for a table using PRAGMA
 */
function getActualColumns(db: Database.Database, tableName: string): Set<string> {
  const columns = new Set<string>()

  const columnInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string
  }>

  for (const col of columnInfo) {
    columns.add(col.name)
  }

  return columns
}

/**
 * Get information about a single database
 */
function getDatabaseInfo(dbPath: string): DatabaseInfo {
  const videoId = extractVideoId(dbPath)
  let db: Database.Database | null = null

  try {
    db = new Database(dbPath, { readonly: true })

    // Get version and metadata
    let version = 0
    let lastVerified: string | null = null

    try {
      const metadata = db
        .prepare('SELECT schema_version, verified_at FROM database_metadata')
        .get() as { schema_version: number; verified_at: string | null } | undefined

      if (metadata) {
        version = metadata.schema_version
        lastVerified = metadata.verified_at
      }
    } catch {
      // database_metadata table doesn't exist or query failed
    }

    // Derive version label from version number and timestamp
    const LATEST_VERSION = -1
    let versionLabel: string
    if (version === LATEST_VERSION) {
      // Format: "latest (2026-01-03)"
      const date = lastVerified ? new Date(lastVerified).toISOString().split('T')[0] : 'unknown'
      versionLabel = `latest (${date})`
    } else {
      versionLabel = `v${version}`
    }

    // Get display path from video_metadata
    let displayPath: string | null = null
    try {
      const videoMeta = db.prepare('SELECT display_path FROM video_metadata').get() as
        | { display_path: string }
        | undefined

      if (videoMeta) {
        displayPath = videoMeta.display_path
      }
    } catch {
      // video_metadata table doesn't exist or query failed
    }

    // Count tables
    const tables = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `
      )
      .get() as { count: number }

    const tableCount = tables.count
    const expectedTableCount = getExpectedTableCount(version)

    // Get actual table names
    const actualTableNames = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all() as Array<{ name: string }>

    const actualTables = new Set(actualTableNames.map(t => t.name))

    // Check for missing tables or columns
    const expectedSchema = getExpectedSchema(version)
    let hasMissingTables = false
    let hasMissingColumns = false

    // Check for missing tables
    for (const expectedTableName of expectedSchema.keys()) {
      if (!actualTables.has(expectedTableName)) {
        hasMissingTables = true
        break
      }
    }

    // Check for extra tables (not in expected schema) - same as repair service
    const extraTables = [...actualTables].filter(table => !expectedSchema.has(table))
    const hasExtraTables = extraTables.length > 0

    // Check for missing/extra columns in existing tables
    let hasExtraColumns = false
    if (!hasMissingTables) {
      for (const [tableName, expectedTable] of expectedSchema) {
        if (!actualTables.has(tableName)) continue

        const actualColumns = getActualColumns(db, tableName)
        const missingColumns = [...expectedTable.columns].filter(col => !actualColumns.has(col))
        const extraColumns = [...actualColumns].filter(col => !expectedTable.columns.has(col))

        if (missingColumns.length > 0) {
          hasMissingColumns = true
          break
        }

        if (extraColumns.length > 0) {
          hasExtraColumns = true
          break
        }
      }
    }

    // Determine status based on schema validity for this version
    let status: DatabaseInfo['status']

    // If no metadata was found (lastVerified is null), database is unversioned
    // Note: v0 is a valid version, so we check lastVerified instead of version === 0
    if (lastVerified === null) {
      status = 'unversioned'
    } else if (hasMissingTables || hasMissingColumns || tableCount < expectedTableCount) {
      // Missing tables/columns = incomplete
      status = 'incomplete'
    } else if (hasExtraTables || hasExtraColumns) {
      // Extra tables/columns = schema drift
      status = 'drift'
    } else {
      // Matches declared version's schema perfectly = valid
      status = 'valid'
    }

    return {
      videoId,
      displayPath,
      version,
      versionLabel,
      status,
      tableCount,
      lastVerified,
    }
  } catch (error) {
    // Database failed to open or query
    return {
      videoId,
      displayPath: null,
      version: 0,
      versionLabel: 'v0',
      status: 'incomplete',
      tableCount: 0,
      lastVerified: null,
    }
  } finally {
    if (db) {
      db.close()
    }
  }
}

/**
 * Get summary status of all databases
 * Phase 1: Synchronous scan (acceptable during development)
 */
export function getDatabaseStatusSummary(): StatusSummary {
  const databases = findAllDatabases()
  const summary: StatusSummary = {
    total: databases.length,
    byVersion: {},
    health: {
      valid: 0,
      drift: 0,
      incomplete: 0,
      unversioned: 0,
      failed: 0,
    },
    lastScan: new Date().toISOString(),
  }

  for (const dbPath of databases) {
    const info = getDatabaseInfo(dbPath)

    // Count by version
    summary.byVersion[info.version] = (summary.byVersion[info.version] || 0) + 1

    // Count by health status
    summary.health[info.status]++
  }

  return summary
}

/**
 * Get detailed status of all databases with optional filtering
 * Phase 1: Synchronous scan (acceptable during development)
 */
export function getDatabaseDetailedStatus(filters?: {
  version?: number
  status?: DatabaseInfo['status']
  search?: string
}): DetailedStatus {
  const databases = findAllDatabases()
  let databaseInfos: DatabaseInfo[] = []

  for (const dbPath of databases) {
    const info = getDatabaseInfo(dbPath)
    databaseInfos.push(info)
  }

  // Apply filters
  if (filters?.version !== undefined) {
    databaseInfos = databaseInfos.filter(db => db.version === filters.version)
  }

  if (filters?.status) {
    databaseInfos = databaseInfos.filter(db => db.status === filters.status)
  }

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase()
    databaseInfos = databaseInfos.filter(
      db =>
        db.videoId.toLowerCase().includes(searchLower) ||
        db.displayPath?.toLowerCase().includes(searchLower)
    )
  }

  // Sort by displayPath, then videoId
  databaseInfos.sort((a, b) => {
    if (a.displayPath && b.displayPath) {
      return a.displayPath.localeCompare(b.displayPath)
    }
    if (a.displayPath) return -1
    if (b.displayPath) return 1
    return a.videoId.localeCompare(b.videoId)
  })

  // Generate summary from filtered results
  const summary: StatusSummary = {
    total: databaseInfos.length,
    byVersion: {},
    health: {
      valid: 0,
      drift: 0,
      incomplete: 0,
      unversioned: 0,
      failed: 0,
    },
    lastScan: new Date().toISOString(),
  }

  for (const info of databaseInfos) {
    summary.byVersion[info.version] = (summary.byVersion[info.version] || 0) + 1
    summary.health[info.status]++
  }

  return {
    summary,
    databases: databaseInfos,
  }
}

/**
 * Get detailed schema information for a specific database
 */
export function getDatabaseSchema(videoId: string): {
  videoId: string
  tables: Array<{ name: string; exists: boolean; columnCount: number }>
  indexes: Array<{ name: string; tableName: string }>
  version: number
} {
  // Find database path by videoId
  const databases = findAllDatabases()
  const dbPath = databases.find(path => path.includes(videoId))

  if (!dbPath) {
    throw new Error(`Database not found for video ${videoId}`)
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    // Get version
    let version = 0
    try {
      const metadata = db.prepare('SELECT schema_version FROM database_metadata').get() as
        | { schema_version: number }
        | undefined
      if (metadata) {
        version = metadata.schema_version
      }
    } catch {
      // No metadata table
    }

    // Get all tables
    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all() as Array<{ name: string }>

    const tableInfo = tables.map(table => {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<unknown>
      return {
        name: table.name,
        exists: true,
        columnCount: columns.length,
      }
    })

    // Get all indexes
    const indexes = db
      .prepare(
        `
      SELECT name, tbl_name as tableName FROM sqlite_master
      WHERE type='index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `
      )
      .all() as Array<{ name: string; tableName: string }>

    return {
      videoId,
      tables: tableInfo,
      indexes,
      version,
    }
  } finally {
    db.close()
  }
}
