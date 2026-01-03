# Migration System Quirks

## SQL Parsing Constraints

**Problem:** Migration runner uses simple string splitting, not true SQL parser.

**Implementation:**

```typescript
const statements = migrationSQL
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))
```

**Consequences:**

### ✅ REQUIRED: All comments at top with semicolon terminator

```sql
-- Migration: Brief description
-- Purpose: Why this exists
-- All comments here;

ALTER TABLE table_name ADD COLUMN new_column TEXT;
```

**Why:** After `split(';')`, if comments are mixed with statements, the trimmed string may start with `--` and get filtered out.

### ❌ FORBIDDEN: Inline or mid-migration comments

```sql
-- ❌ This gets filtered out
ALTER TABLE table_name ADD COLUMN col1 TEXT;  -- Also breaks

-- ❌ This statement disappears
ALTER TABLE table_name ADD COLUMN col2 TEXT;
```

### ✅ REQUIRED: Semicolon on separate line or end of statement

```sql
ALTER TABLE table_name ADD COLUMN new_column TEXT;
```

**Why:** `split(';')` creates parts between semicolons. Each part must be a complete statement.

## Incomplete Database Handling

**Problem:** Some databases missing core tables due to interrupted processing.

**Solution:** Check table existence before modifying:

```typescript
export function migrateXXX_Description(dbPath: string): boolean {
  const db = new Database(dbPath)
  try {
    // Check if table exists before modifying
    if (!tableExists(db, 'table_name')) {
      return false  // Skip migration for incomplete databases
    }

    // Check if already applied
    if (columnExists(db, 'table_name', 'new_column')) {
      return false
    }

    // ... apply migration
  }
}
```

**Pattern:** Every migration that modifies a table must verify that table exists first.

## Migration Registration

**Location:** `app/db/migrate.ts`

Add migration function to `migrateDatabase()`:

```typescript
export function migrateDatabase(dbPath: string): void {
  migrateXXX_Description(dbPath) // Add new migrations here
}
```

**Critical:** Migrations run in order listed. Add new migrations to the end.
