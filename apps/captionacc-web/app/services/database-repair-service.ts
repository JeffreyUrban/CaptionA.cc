/**
 * Database repair service
 *
 * Repairs databases to match current schema version.
 * Same logic as repair-databases.ts script but exposed as a service.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import Database from 'better-sqlite3'

import { CURRENT_SCHEMA_VERSION, LATEST_SCHEMA_VERSION } from '~/db/migrate'
import { getSchemaPath as getSchemaPathFromLoader } from '~/db/schema-loader'
import { parseSchemaFull, type ColumnDefinition } from '~/utils/schema-parser'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LOCAL_DATA_DIR =
  process.env['LOCAL_DATA_DIR'] ?? join(__dirname, '../../../../local/processing')
const SCHEMA_DIR = join(__dirname, '../db')

/**
 * Get schema file path for target version
 * Uses centralized schema-loader for consistent path resolution
 */
function getSchemaPath(version: number): string {
  return getSchemaPathFromLoader(version, SCHEMA_DIR)
}

interface RepairResult {
  path: string
  status: 'current' | 'repaired' | 'failed' | 'needs_confirmation'
  actions: string[]
  destructiveActions: string[]
  error?: string
}

export interface RepairSummary {
  total: number
  current: number
  repaired: number
  failed: number
  needsConfirmation: number
  schemaVersion: number
  hasDestructiveChanges: boolean
  destructiveActionsSummary?: {
    tablesToRemove: Record<string, { databases: number; totalRows: number }>
    columnsToRemove: Record<string, { databases: number }>
  }
  results: RepairResult[]
}

function getActualTables(db: Database.Database): Set<string> {
  const tables = db
    .prepare(
      `
    SELECT name FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `
    )
    .all() as Array<{ name: string }>

  return new Set(tables.map(t => t.name))
}

function getActualColumns(db: Database.Database, tableName: string): Map<string, ColumnDefinition> {
  const columns = new Map<string, ColumnDefinition>()

  const columnInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>

  for (const col of columnInfo) {
    columns.set(col.name, {
      name: col.name,
      type: col.type.toUpperCase(),
      notnull: !!col.notnull,
      dflt_value: col.dflt_value,
      pk: !!col.pk,
    })
  }

  return columns
}

function repairDatabase(
  dbPath: string,
  schemaSQL: string,
  targetVersion: number,
  force: boolean = false
): RepairResult {
  const result: RepairResult = {
    path: dbPath.replace(LOCAL_DATA_DIR + '/', ''),
    status: 'current',
    actions: [],
    destructiveActions: [],
  }

  let db: Database.Database | null = null

  try {
    db = new Database(dbPath)

    // Add missing tables/columns to match target schema
    const expectedTables = parseSchemaFull(schemaSQL)
    const actualTables = getActualTables(db)

    const missingTables = [...expectedTables.keys()].filter(t => !actualTables.has(t))

    if (missingTables.length > 0) {
      result.actions.push(`Missing tables: ${missingTables.join(', ')}`)
      result.status = 'repaired'
      db.exec(schemaSQL)
      result.actions.push('Created missing tables')

      actualTables.clear()
      for (const name of getActualTables(db)) {
        actualTables.add(name)
      }
    }

    for (const [tableName, expectedSchema] of expectedTables) {
      if (!actualTables.has(tableName)) continue

      const actualColumns = getActualColumns(db, tableName)
      const missingColumns = [...expectedSchema.columns.keys()].filter(
        col => !actualColumns.has(col)
      )

      if (missingColumns.length > 0) {
        result.status = 'repaired'

        for (const colName of missingColumns) {
          const colDef = expectedSchema.columns.get(colName)
          if (!colDef) continue

          let alterSQL = `ALTER TABLE ${tableName} ADD COLUMN ${colDef.name} ${colDef.type}`

          if (colDef.dflt_value) {
            alterSQL += ` DEFAULT ${colDef.dflt_value}`
          }

          try {
            db.exec(alterSQL)
            result.actions.push(`Added column: ${tableName}.${colName}`)
          } catch (error) {
            result.actions.push(`Failed to add ${tableName}.${colName}: ${error}`)
          }
        }
      }
    }

    // Detect extra tables (not in expected schema)
    // Note: getActualTables() already filters out sqlite_* internal tables
    const extraTables = [...actualTables].filter(table => !expectedTables.has(table))

    if (extraTables.length > 0) {
      for (const tableName of extraTables) {
        // Check if table has data
        const rowCount = (
          db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number }
        ).count
        const hasData = rowCount > 0

        if (hasData) {
          result.destructiveActions.push(
            `Remove table: ${tableName} (contains ${rowCount} row${rowCount !== 1 ? 's' : ''})`
          )
        }

        if (force) {
          try {
            db.exec(`DROP TABLE IF EXISTS ${tableName}`)
            result.actions.push(`Removed extra table: ${tableName}`)
            result.status = 'repaired'
          } catch (error) {
            result.actions.push(`Failed to remove table ${tableName}: ${error}`)
          }
        } else if (hasData) {
          result.status = 'needs_confirmation'
        } else {
          // No data, safe to remove without confirmation
          try {
            db.exec(`DROP TABLE IF EXISTS ${tableName}`)
            result.actions.push(`Removed empty table: ${tableName}`)
            result.status = 'repaired'
          } catch (error) {
            result.actions.push(`Failed to remove table ${tableName}: ${error}`)
          }
        }
      }
    }

    // Detect extra columns (not in expected schema)
    for (const tableName of actualTables) {
      if (!expectedTables.has(tableName)) continue

      const expectedSchema = expectedTables.get(tableName)!
      const actualColumns = getActualColumns(db, tableName)
      const extraColumns = [...actualColumns.keys()].filter(col => !expectedSchema.columns.has(col))

      if (extraColumns.length > 0) {
        // Check if any extra columns have data
        const columnsWithData: string[] = []
        const emptyColumns: string[] = []

        for (const colName of extraColumns) {
          const hasData =
            (
              db
                .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${colName} IS NOT NULL`)
                .get() as { count: number }
            ).count > 0

          if (hasData) {
            columnsWithData.push(colName)
          } else {
            emptyColumns.push(colName)
          }
        }

        // Report columns with data as destructive actions
        if (columnsWithData.length > 0) {
          for (const colName of columnsWithData) {
            result.destructiveActions.push(`Remove column: ${tableName}.${colName} (contains data)`)
          }

          if (!force) {
            result.status = 'needs_confirmation'
          }
        }

        // Remove extra columns (both empty and with data if force=true)
        const columnsToRemove = force ? extraColumns : emptyColumns

        if (columnsToRemove.length > 0) {
          try {
            // Get the CREATE TABLE statement for this table from the schema
            const tableDefMatch = schemaSQL.match(
              new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\s*\\([\\s\\S]*?\\);`, 'i')
            )

            if (!tableDefMatch) {
              result.actions.push(
                `Cannot remove columns from ${tableName}: Table definition not found in schema`
              )
            } else {
              const createTableSQL = tableDefMatch[0].replace(
                /CREATE TABLE IF NOT EXISTS/,
                'CREATE TABLE'
              )
              const keepColumns = [...expectedSchema.columns.keys()]
              const columnList = keepColumns.join(', ')

              // Recreate table with proper schema (removes ALL extra columns at once)
              const tempTableName = `_temp_${tableName}_${Date.now()}`
              db.exec(`
                ALTER TABLE ${tableName} RENAME TO ${tempTableName};
                ${createTableSQL}
                INSERT INTO ${tableName} (${columnList}) SELECT ${columnList} FROM ${tempTableName};
                DROP TABLE ${tempTableName};
              `)

              const removedCount = columnsToRemove.length
              const hadData = columnsWithData.some(col => columnsToRemove.includes(col))
              result.actions.push(
                `Removed ${removedCount} column(s) from ${tableName}${hadData ? ' (data discarded)' : ''}: ${columnsToRemove.join(', ')}`
              )
              result.status = 'repaired'
            }
          } catch (error) {
            result.actions.push(`Failed to remove empty columns from ${tableName}: ${error}`)
          }
        }
      }
    }

    // Check version metadata
    const actualTablesRefresh = getActualTables(db)
    const hasMetadata = actualTables.has('database_metadata')

    if (!hasMetadata) {
      result.actions.push('Missing database_metadata table')
      result.status = 'repaired'
    } else {
      try {
        const metadata = db.prepare('SELECT schema_version FROM database_metadata').get() as
          | { schema_version: number }
          | undefined

        if (!metadata) {
          result.actions.push('Missing version metadata row')
          result.status = 'repaired'
        } else if (metadata.schema_version !== targetVersion) {
          result.actions.push(`Version change: ${metadata.schema_version} → ${targetVersion}`)
          result.status = 'repaired'
        }
      } catch {
        result.actions.push('Could not read version metadata')
        result.status = 'repaired'
      }
    }

    // Update version if needed
    if (result.status === 'repaired') {
      const metadataExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='database_metadata'")
        .get()

      if (!metadataExists) {
        db.exec(schemaSQL)
      }

      const rowExists = db.prepare('SELECT id FROM database_metadata WHERE id = 1').get()

      // Format version label for display in actions
      const versionLabel = targetVersion === LATEST_SCHEMA_VERSION ? 'latest' : `v${targetVersion}`

      if (!rowExists) {
        db.prepare(
          `
          INSERT INTO database_metadata (
            schema_version,
            created_at,
            verified_at
          ) VALUES (?, datetime('now'), datetime('now'))
        `
        ).run(targetVersion)
        result.actions.push(`Set version to ${versionLabel}`)
      } else {
        db.prepare(
          `
          UPDATE database_metadata
          SET schema_version = ?,
              verified_at = datetime('now')
          WHERE id = 1
        `
        ).run(targetVersion)
        result.actions.push(`Updated version to ${versionLabel}`)
      }
    }
  } catch (error) {
    result.status = 'failed'
    result.error = String(error)
  } finally {
    if (db) {
      db.close()
    }
  }

  return result
}

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
          } else if (entry === 'captions.db' && stat.size > 0) {
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
 * Repair all databases to target schema version
 *
 * @param targetVersion - Target schema version to repair to
 * @param force - If true, apply destructive changes without confirmation
 */
export async function repairAllDatabases(
  targetVersion: number = CURRENT_SCHEMA_VERSION,
  force: boolean = false
): Promise<RepairSummary> {
  const schemaPath = getSchemaPath(targetVersion)
  const schemaSQL = readFileSync(schemaPath, 'utf-8')
  const databases = findAllDatabases()

  // Debug: Log parsed schema for captions table
  const parsedSchema = parseSchemaFull(schemaSQL)
  const captionsSchema = parsedSchema.get('captions')
  if (captionsSchema) {
    console.log('[RepairAPI] Expected columns for captions:', [...captionsSchema.columns.keys()])
  }

  const results: RepairResult[] = []

  for (let i = 0; i < databases.length; i++) {
    const dbPath = databases[i]
    if (!dbPath) continue
    const result = repairDatabase(dbPath, schemaSQL, targetVersion, force)
    results.push(result)

    // Log progress every 50 databases
    if ((i + 1) % 50 === 0 || i + 1 === databases.length) {
      console.log(`[RepairAPI] Progress: ${i + 1}/${databases.length} databases processed`)
    }
  }

  const hasDestructiveChanges = results.some(r => r.destructiveActions.length > 0)

  // Build summary of destructive actions (avoid overwhelming list)
  let destructiveActionsSummary
  if (hasDestructiveChanges) {
    const tablesToRemove: Record<string, { databases: number; totalRows: number }> = {}
    const columnsToRemove: Record<string, { databases: number }> = {}

    for (const result of results) {
      for (const action of result.destructiveActions) {
        // Parse "Remove table: X (contains N rows)"
        const tableMatch = action.match(/Remove table: (\w+) \(contains (\d+) rows?\)/)
        if (tableMatch?.[1] && tableMatch[2]) {
          const tableName = tableMatch[1]
          const rowCount = parseInt(tableMatch[2], 10)

          if (!tablesToRemove[tableName]) {
            tablesToRemove[tableName] = { databases: 0, totalRows: 0 }
          }
          tablesToRemove[tableName].databases++
          tablesToRemove[tableName].totalRows += rowCount
        }

        // Parse "Remove column: X.Y (contains data)"
        const columnMatch = action.match(/Remove column: (\w+)\.(\w+)/)
        if (columnMatch?.[1] && columnMatch[2]) {
          const fullColumn = `${columnMatch[1]}.${columnMatch[2]}`
          if (!columnsToRemove[fullColumn]) {
            columnsToRemove[fullColumn] = { databases: 0 }
          }
          columnsToRemove[fullColumn].databases++
        }
      }
    }

    destructiveActionsSummary = { tablesToRemove, columnsToRemove }
  }

  const summary: RepairSummary = {
    total: databases.length,
    current: results.filter(r => r.status === 'current').length,
    repaired: results.filter(r => r.status === 'repaired').length,
    failed: results.filter(r => r.status === 'failed').length,
    needsConfirmation: results.filter(r => r.status === 'needs_confirmation').length,
    schemaVersion: targetVersion,
    hasDestructiveChanges,
    destructiveActionsSummary,
    results,
  }

  return summary
}
