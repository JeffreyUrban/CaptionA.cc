# Schema Versioning Challenges

## Per-Video Architecture Implications

**Challenge:** Standard migration tracking patterns assume single database.

**Our Reality:** Many independent SQLite databases with no shared state.

### Problems

1. **No global schema version** - Each database tracks its own state (or doesn't)
2. **Incomplete databases exist** - Some databases created but never fully initialized
3. **Can't query "which databases need migration"** - Must scan filesystem and check each
4. **Individual failures** - Migration may succeed on 90% of databases, fail on 10%

### Current Approach

**Detection:** Each migration checks if already applied by examining schema:

- `columnExists(db, 'table', 'column')` for column additions
- `tableExists(db, 'table')` for table creations
- `schema.sql.includes('value')` for CHECK constraint modifications

**Consequences:**

- Idempotent by necessity (migrations run multiple times safely)
- No migration history tracking
- No way to know which specific migrations applied
- Manual "already applied" check in every migration function

### Standard Patterns That Don't Apply

**Schema migrations table:** Would need to be created/maintained in every database independently. No way to query "show me all databases at schema v7" without scanning all databases.

**Centralized tracking:** Fundamentally incompatible with per-video isolation.

**Migration ordering guarantees:** Only enforced by order in `migrateDatabase()` function, not by database state.

## Adapting to This Architecture

**Accept:** Per-video isolation means per-video schema state. No global view.

**Embrace:** Idempotent migrations, table existence checks, graceful incomplete database handling.

**Future consideration:** If migrating to centralized database, current per-video approach makes data migration straightforward (each database is independent unit).
