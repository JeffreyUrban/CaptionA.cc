# Database Schema Files

## Schema Files

- `annotations-schema.sql` - Latest working schema (may have unreleased changes)
- `annotations-schema-v{N}.sql` - Frozen schemas for specific released versions (v0, v1, etc.)
- `migrate.ts` - Version constants and migration utilities

## Versioning

- `CURRENT_SCHEMA_VERSION` - Latest released version (stored as `schema_version` in database)
- `LATEST_SCHEMA_VERSION = -1` - Special value for unreleased working schema

Each database stores:

- `schema_version` (INTEGER) - Version number (-1 for latest, 0/1/2/... for releases)
- `verified_at` (TIMESTAMP) - When last repaired/verified

## Repair

Admin dashboard (http://localhost:5173/admin) provides repair to:

- **Latest** - Uses working schema, sets version to -1
- **v1, v0, etc.** - Uses frozen versioned schemas, sets version accordingly

Repair adds missing tables/columns for current/latest versions. For older versions, only sets version number.

## Documentation

See [`docs/database/`](../../docs/database/) for complete documentation:

- [README.md](../../docs/database/README.md) - Database overview
- [versioning-strategy.md](../../docs/database/versioning-strategy.md) - Versioning approach
- [migrations.md](../../docs/database/migrations.md) - Migration details
