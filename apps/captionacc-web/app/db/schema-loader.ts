/**
 * Schema file selection and loading for new databases
 *
 * Centralized logic for determining which schema file to use when creating new databases.
 */

// TODO: The database details in this file are out of date.

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

import { CURRENT_SCHEMA_VERSION, LATEST_SCHEMA_VERSION } from './migrate'

// ============================================================================
// SCHEMA FILE NAMING CONVENTION - READ BEFORE MODIFYING THIS CODE
// ============================================================================
//
// This module selects which schema file to use when creating new databases.
//
// CORRECT filenames in app/db/:
//   annotations-schema-latest.sql  → unreleased/development schema (version -1)
//   annotations-schema-v2.sql      → released version 2 (CURRENT_SCHEMA_VERSION)
//   annotations-schema-v1.sql      → released version 1
//   annotations-schema-v0.sql      → released version 0
//
// INCORRECT filenames - DO NOT USE:
//   annotations-schema.sql         → NO - ambiguous, breaks versioning strategy
//
// Selection logic:
//   1. If annotations-schema-latest.sql exists → use it with version = -1
//   2. Otherwise → use annotations-schema-v{CURRENT_SCHEMA_VERSION}.sql
//
// The -latest file is OPTIONAL and may not exist in production.
// When absent, new databases use the highest released version (currently v2).
//
// DO NOT modify this logic without understanding the full versioning strategy
// documented in app/db/README.md
//
// ============================================================================

export interface SchemaSelection {
  /** Absolute path to the schema file */
  path: string
  /** Schema version number (-1 for latest, 0/1/2/... for releases) */
  version: number
  /** SQL content of the schema file */
  content: string
}

/**
 * Get the schema file to use for creating a new database.
 *
 * Checks for latest unreleased schema first, falls back to current released version.
 *
 * @param baseDir - Base directory (defaults to app/db relative to this file)
 * @returns Schema file path, version, and content
 * @throws Error if neither latest nor versioned schema file exists
 */
export function getSchemaForNewDatabase(baseDir?: string): SchemaSelection {
  const schemaDir = baseDir ?? resolve(__dirname)

  const latestSchemaPath = resolve(schemaDir, 'annotations-schema-latest.sql')
  const versionedSchemaPath = resolve(
    schemaDir,
    `annotations-schema-v${CURRENT_SCHEMA_VERSION}.sql`
  )

  let schemaPath: string
  let schemaVersion: number

  if (existsSync(latestSchemaPath)) {
    // Use latest unreleased schema
    schemaPath = latestSchemaPath
    schemaVersion = LATEST_SCHEMA_VERSION
    console.log('[Schema] Using latest unreleased schema (version -1)')
  } else if (existsSync(versionedSchemaPath)) {
    // Fall back to highest numbered version
    schemaPath = versionedSchemaPath
    schemaVersion = CURRENT_SCHEMA_VERSION
    console.log(`[Schema] Using versioned schema v${CURRENT_SCHEMA_VERSION}`)
  } else {
    throw new Error(
      `No schema file found. Expected either:\n` +
        `  - ${latestSchemaPath}\n` +
        `  - ${versionedSchemaPath}`
    )
  }

  const content = readFileSync(schemaPath, 'utf-8')

  return {
    path: schemaPath,
    version: schemaVersion,
    content,
  }
}

/**
 * Check if the latest unreleased schema file exists.
 *
 * Used by Admin UI to conditionally show "Latest" repair option.
 *
 * @param baseDir - Base directory (defaults to app/db relative to this file)
 * @returns true if annotations-schema-latest.sql exists
 */
export function hasLatestSchema(baseDir?: string): boolean {
  const schemaDir = baseDir ?? resolve(__dirname)
  const latestSchemaPath = resolve(schemaDir, 'annotations-schema-latest.sql')
  return existsSync(latestSchemaPath)
}

/**
 * Get the schema file path for a specific version.
 *
 * Used by repair/admin services that need to work with any schema version.
 *
 * @param version - Schema version number (-1 for latest, 0/1/2/... for releases)
 * @param baseDir - Base directory (defaults to app/db relative to this file)
 * @returns Absolute path to the schema file
 */
export function getSchemaPath(version: number, baseDir?: string): string {
  const schemaDir = baseDir ?? resolve(__dirname)

  if (version === LATEST_SCHEMA_VERSION) {
    return resolve(schemaDir, 'annotations-schema-latest.sql')
  }

  return resolve(schemaDir, `annotations-schema-v${version}.sql`)
}
