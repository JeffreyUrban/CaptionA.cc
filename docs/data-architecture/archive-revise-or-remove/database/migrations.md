# Database Migrations and Repairs

## Philosophy: Development Flexibility + Versioned Standardization

**Balance:**

- ✅ **Repair incomplete databases** - Development flexibility, partial recovery better than total loss
- ✅ **Aim for strict versioning** - Track and report deviations from standard schema
- ✅ **Forgiving of corruption** - Recover what we can, report what we can't
- ⚠️ **Not production yet** - Can be more experimental during development

## Database Repair

**Purpose:** Bring incomplete or corrupted databases up to current schema.

**Tool:** `scripts/repair-databases.ts`

**When to use:**

- After restoring backups
- When databases have missing tables
- After schema changes during development
- As health check / validation

**What it does:**

1. Scans all databases in `!__local/data/_has_been_deprecated__!`
2. Compares actual tables vs expected (from `annotations-schema.sql`)
3. Applies full schema to fill gaps (idempotent - uses `CREATE TABLE IF NOT EXISTS`)
4. Sets/updates `database_metadata.schema_version` to current version
5. Reports: current, repaired, failed

**Running repair:**

```bash
npx tsx scripts/repair-databases.ts
```

**Output example:**

```
Expected tables (12): video_metadata, full_frame_ocr, ...
Found 374 databases

[1/374] Checking... ✓
[2/374] Checking... 🔧 REPAIRED
  - Missing tables: video_metadata, database_metadata
  - Applied full schema
  - Set version to 1
[3/374] Checking... ✓
...

=== Repair Summary ===
Total databases: 374
Current (v1): 370 ✓
Repaired: 4 🔧
Failed: 0
```

## Future Migrations

**Pattern:** Version-based migration (not individual migration tracking).

### Creating a Migration

1. **Update schema file** with new version number:

```sql
-- Schema version: 2

-- New table or column
CREATE TABLE IF NOT EXISTS new_feature (...);
```

2. **Create migration SQL file** `app/db/migrations/v2.sql`:

```sql
-- Migration to version 2
-- Add new_feature table for X functionality

CREATE TABLE IF NOT EXISTS new_feature (
    id INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    data TEXT
);

CREATE INDEX IF NOT EXISTS idx_new_feature_video
    ON new_feature(video_id);
```

3. **Update migration runner** in `app/db/migrate.ts`:

```typescript
import { readFileSync } from 'fs'
import { join } from 'path'

export const CURRENT_SCHEMA_VERSION = 2 // Update version

export function migrateDatabase(dbPath: string): void {
  const db = new Database(dbPath)

  try {
    // Get current version
    const metadata = db.prepare('SELECT schema_version FROM database_metadata').get() as
      | { schema_version: number }
      | undefined

    const currentVersion = metadata?.schema_version ?? 0

    // Apply pending migrations
    if (currentVersion < 2) {
      const migrationSQL = readFileSync(join(__dirname, 'migrations/v2.sql'), 'utf-8')
      db.exec(migrationSQL) // SQLite parses it - no quirks!

      db.prepare(
        'UPDATE database_metadata SET schema_version = 2, migrated_at = datetime("now")'
      ).run()
    }

    // Future migrations go here
    // if (currentVersion < 3) { ... }
  } finally {
    db.close()
  }
}
```

4. **Run migration on all databases:**

```bash
# Create orchestrator script
npx tsx scripts/migrate-all-databases.ts
```

### Migration SQL - No Special Constraints

Use **better-sqlite3's `exec()`** - it uses SQLite's parser, so:

✅ **Comments anywhere:**

```sql
-- Header comment
CREATE TABLE foo (...);

-- Mid-migration comment is fine
ALTER TABLE bar ADD COLUMN new_col TEXT;  -- Inline comment also fine
```

✅ **Normal SQL formatting:**

```sql
CREATE TABLE multi_line (
    id INTEGER PRIMARY KEY,
    data TEXT  -- Comment here works
);
```

✅ **Semicolons handled correctly** (even in strings, triggers, etc.)

**No parsing quirks.** Write normal SQL.

### Idempotency

Always use:

- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- Check column existence before `ALTER TABLE ADD COLUMN`

```typescript
// For adding columns (not available as IF NOT EXISTS)
if (currentVersion < 2) {
  if (!columnExists(db, 'video_preferences', 'new_setting')) {
    db.exec('ALTER TABLE video_preferences ADD COLUMN new_setting TEXT')
  }
  // Update version...
}
```

## Migration vs Repair

**Migrations** - Incremental schema evolution:

- Version 1 → 2: Add new table
- Version 2 → 3: Add column to existing table
- Checks current version, applies only needed migrations

**Repair** - Schema enforcement:

- Compares actual vs expected tables
- Applies full current schema to fill gaps
- Sets version to current
- Use when databases are incomplete or corrupted

**When to use which:**

- **Normal operation:** Migration runner (incremental updates)
- **After backup restoration:** Repair tool (may be missing many tables)
- **Development:** Repair tool (quick way to sync all databases to current schema)
- **Health check:** Repair tool with dry-run mode (report only)

## Incomplete Databases

**Reality:** Incomplete databases can exist due to:

- Interrupted initialization
- Corruption
- Failed migrations
- Restored partial backups

**Strategy:**

- ✅ Repair them (apply missing schema)
- ✅ Report what was repaired
- ✅ Recover what we can
- ❌ Don't delete (partial data better than no data)

**Future:** As we approach production, tighten this to reject incomplete databases rather than repair.
