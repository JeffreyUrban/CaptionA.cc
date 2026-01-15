# Database Schema Files

## Schema Files

- `annotations-schema-latest.sql` - (Optional) Latest unreleased working schema
- `annotations-schema-v{N}.sql` - Frozen schemas for specific released versions (v0, v1, v2, etc.)
- `migrate.ts` - Version constants and migration utilities

## Versioning

- `CURRENT_SCHEMA_VERSION` - Latest released version (currently 2)
- `LATEST_SCHEMA_VERSION = -1` - Special value for unreleased working schema

Each database stores:

- `schema_version` (INTEGER) - Version number (-1 for latest unreleased, 0/1/2/... for releases)
- `verified_at` (TIMESTAMP) - When last repaired/verified

## New Database Creation Policy

When creating new databases (via upload or init script), the system follows this priority:

1. **If `annotations-schema-latest.sql` exists**: Use it with `LATEST_SCHEMA_VERSION` (-1)
2. **Otherwise**: Use `annotations-schema-v{CURRENT_SCHEMA_VERSION}.sql` with the current version number

This allows for:

- Development of unreleased schema changes in `annotations-schema-latest.sql`
- Stable production deployments using only versioned schemas
- Automatic fallback to the highest released version when no unreleased schema exists

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
