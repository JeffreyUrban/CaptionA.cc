# Supabase Documentation

## Setup Guides

- **[PLATFORM_ADMIN_SETUP.md](PLATFORM_ADMIN_SETUP.md)** - Schema setup and platform admin access
- **[MULTI_SCHEMA_SETUP.md](MULTI_SCHEMA_SETUP.md)** - Multi-schema architecture (reference)

## Architecture

- **[multi-schema-architecture-plan.md](multi-schema-architecture-plan.md)** - Multi-schema design and implementation

## Environment Strategy

CaptionA.cc uses separate Supabase projects for prod and dev, with the same schema name in each:

| Environment | Supabase Project | Schema |
|-------------|------------------|--------|
| Production  | (prod project)   | `captionacc` |
| Development | (dev project)    | `captionacc` |

This provides complete data isolation while keeping the codebase simple.

## Key Files

- **Schema migration:** `supabase/migrations/20260121000000_captionacc_schema.sql`
- **Admin setup script:** `supabase/scripts/setup_admin.sql`
