/**
 * Database administration service
 *
 * Provides observability and control over database versioning across all video databases.
 * Phase 1: Basic synchronous status queries
 */

import { readdirSync, statSync } from 'fs'
import { join } from 'path'

import Database from 'better-sqlite3'

import { CURRENT_SCHEMA_VERSION } from '~/db/migrate'

const LOCAL_DATA_DIR = process.env['LOCAL_DATA_DIR'] ?? '../../local/data'

export interface DatabaseInfo {
  videoId: string
  displayPath: string | null
  version: number
  status: 'current' | 'outdated' | 'incomplete' | 'unversioned'
  tableCount: number
  lastVerified: string | null
  schemaChecksum: string | null
}

export interface StatusSummary {
  total: number
  byVersion: Record<number, number>
  health: {
    current: number
    outdated: number
    incomplete: number
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
 * Path format: .../local/data/{hash}/{uuid}/annotations.db
 */
function extractVideoId(dbPath: string): string {
  const parts = dbPath.split('/')
  // Find the UUID part (second-to-last directory before annotations.db)
  const uuidIndex = parts.length - 2
  return parts[uuidIndex] ?? 'unknown'
}

/**
 * Get expected tables from schema
 */
function getExpectedTableCount(): number {
  // Based on annotations-schema.sql version 1
  return 12 // captions, full_frame_ocr, full_frame_box_labels, full_frames, cropped_frames, video_layout_config, box_classification_model, video_preferences, video_metadata, duplicate_resolution, processing_status, database_metadata
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
    let schemaChecksum: string | null = null

    try {
      const metadata = db
        .prepare('SELECT schema_version, verified_at, schema_checksum FROM database_metadata')
        .get() as
        | { schema_version: number; verified_at: string | null; schema_checksum: string | null }
        | undefined

      if (metadata) {
        version = metadata.schema_version
        lastVerified = metadata.verified_at
        schemaChecksum = metadata.schema_checksum
      }
    } catch {
      // database_metadata table doesn't exist or query failed
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
    const expectedTableCount = getExpectedTableCount()

    // Determine status
    let status: DatabaseInfo['status']
    if (version === 0) {
      status = 'unversioned'
    } else if (tableCount < expectedTableCount) {
      status = 'incomplete'
    } else if (version < CURRENT_SCHEMA_VERSION) {
      status = 'outdated'
    } else {
      status = 'current'
    }

    return {
      videoId,
      displayPath,
      version,
      status,
      tableCount,
      lastVerified,
      schemaChecksum,
    }
  } catch (error) {
    // Database failed to open or query
    return {
      videoId,
      displayPath: null,
      version: 0,
      status: 'incomplete',
      tableCount: 0,
      lastVerified: null,
      schemaChecksum: null,
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
      current: 0,
      outdated: 0,
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
      current: 0,
      outdated: 0,
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
