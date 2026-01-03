# Schema Versioning Strategy

## Approach: Schema Version Number

**Decision:** Track schema version number in each database, not individual migration history.

**Rationale:** Databases are independent, frequently added/deleted, and restored from backups at different schema versions. Version number provides exactly what's needed: "Is this database current?"

## Database Metadata Table

```sql
CREATE TABLE IF NOT EXISTS database_metadata (
    id INTEGER PRIMARY KEY CHECK(id = 1),

    -- Schema version tracking
    schema_version INTEGER NOT NULL,
    schema_checksum TEXT,              -- SHA256 of schema for verification

    -- Lifecycle tracking
    created_at TEXT NOT NULL,
    migrated_at TEXT,                  -- When last migration applied
    verified_at TEXT                   -- When schema last verified
);
```

**Schema version semantics:**

- Version 9 = migrations 001-009 applied
- Version 0 = new/uninitialized database
- Current version defined in code (e.g., `const CURRENT_SCHEMA_VERSION = 9`)

## Migration Pattern

### Per-Database Migration

```typescript
export function migrateDatabase(dbPath: string): void {
  const db = new Database(dbPath)

  try {
    // Get current database version
    const result = db.prepare('SELECT schema_version FROM database_metadata').get() as
      | { schema_version: number }
      | undefined

    const dbVersion = result?.schema_version ?? 0

    // Run pending migrations
    for (let v = dbVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      applyMigration(db, v)
    }

    // Update version and checksum
    const schemaChecksum = computeSchemaChecksum(db)
    db.prepare(
      `
      UPDATE database_metadata
      SET schema_version = ?,
          schema_checksum = ?,
          migrated_at = datetime('now'),
          verified_at = datetime('now')
    `
    ).run(CURRENT_SCHEMA_VERSION, schemaChecksum)
  } finally {
    db.close()
  }
}
```

### Global Migration Orchestrator

```typescript
// Scan all databases and migrate
async function migrateAllDatabases() {
  const databases = findAllDatabases()
  const results = { current: 0, migrated: 0, failed: 0 }

  for (const dbPath of databases) {
    const version = getDatabaseVersion(dbPath)

    if (version === CURRENT_SCHEMA_VERSION) {
      results.current++
    } else {
      try {
        migrateDatabase(dbPath)
        results.migrated++
      } catch (error) {
        results.failed++
        console.error(`Failed to migrate ${dbPath}:`, error)
      }
    }
  }

  return results
}
```

## Use Cases

### Restore Old Backup

```
1. Restore backup from storage
2. Check version: SELECT schema_version FROM database_metadata → 5
3. Current version: 9
4. Migration runner applies migrations 006-009
5. Database updated to version 9
```

### Add New Video

```sql
-- Initialize new database at current version
INSERT INTO database_metadata (
    schema_version,
    created_at,
    verified_at
) VALUES (9, datetime('now'), datetime('now'));
```

### Delete Video

```
rm -rf local/data/{hash}/{uuid}/
```

No migration history cleanup needed - entire database deleted.

### Health Check

```typescript
// Aggregate versions across all databases
function checkDatabaseHealth() {
  const databases = findAllDatabases()
  const versionCounts = new Map<number, number>()

  for (const dbPath of databases) {
    const version = getDatabaseVersion(dbPath)
    versionCounts.set(version, (versionCounts.get(version) || 0) + 1)
  }

  console.log('Database Version Report:')
  for (const [version, count] of versionCounts.entries()) {
    const status = version === CURRENT_SCHEMA_VERSION ? '✓' : '⚠'
    console.log(`  Version ${version}: ${count} databases ${status}`)
  }
}
```

## Schema Verification

**Checksum approach:** Hash critical schema elements to detect drift/corruption.

```typescript
function computeSchemaChecksum(db: Database): string {
  // Get table definitions in deterministic order
  const schema = db
    .prepare(
      `
    SELECT sql FROM sqlite_master
    WHERE type IN ('table', 'index', 'view')
    ORDER BY name
  `
    )
    .all()

  const schemaSQL = schema.map(s => s.sql).join('\n')
  return sha256(schemaSQL)
}
```

**Verification workflow:**

1. After migration: compute and store checksum
2. On database open: optionally verify checksum matches expected
3. Health check: report databases with mismatched checksums

## Operational Tools

### Migration Runner

```bash
# Migrate all databases
npx tsx scripts/migrate-all-databases.ts

# Output:
# Scanning databases...
# Current (v9): 350 databases ✓
# Needs migration: 24 databases
# [1/24] Migrating {hash}/{uuid}... ✓
# [2/24] Migrating {hash}/{uuid}... ✓
# ...
# Complete: 24 migrated, 0 failed
```

### Health Check

```bash
# Check schema versions
npx tsx scripts/check-database-health.ts

# Output:
# Database Version Report:
#   Version 9: 374 databases ✓
#   Version 8: 0 databases
#   Incomplete: 0 databases
```

## Architecture Benefits

**Parallel execution:** Databases are independent, can migrate concurrently

**Isolated failures:** One corrupt database doesn't block others

**Incremental progress:** Can resume after partial failure

**Simple cleanup:** Delete database = delete directory, no shared state to update

## Creating New Database

**Initialize at current version:**

```typescript
function createNewDatabase(dbPath: string): void {
  const db = new Database(dbPath)

  // Apply current schema
  db.exec(readFileSync('app/db/annotations-schema.sql', 'utf-8'))

  // Initialize metadata at current version
  db.prepare(
    `
    INSERT INTO database_metadata (
      schema_version,
      created_at,
      verified_at
    ) VALUES (?, datetime('now'), datetime('now'))
  `
  ).run(CURRENT_SCHEMA_VERSION)

  db.close()
}
```

All databases have `database_metadata` table. New databases initialized at current version.
