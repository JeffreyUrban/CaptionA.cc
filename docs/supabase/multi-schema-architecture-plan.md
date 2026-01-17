# Multi-Schema Architecture

## Overview
CaptionA.cc uses PostgreSQL schemas for environment isolation within a single Supabase project, supporting production, staging, and optional services.

## Schema Organization

**Four Schemas (using `captionacc_*` prefix):**

1. **`captionacc_production`** - Production environment
   - All application tables (tenants, videos, user_profiles, etc.)
   - Used by: production Fly.io deployment
   - Full RLS policies active

2. **`captionacc_staging`** - Testing/review environments
   - Mirror of production schema structure
   - Used by: Fly.io review apps, staging deployment
   - Separate data from production
   - Full RLS policies active

3. **`captionacc_prefect`** - Prefect workflow orchestration (optional)
   - Prefect Server tables (flow_run, task_run, deployments, etc.)
   - Used by: Self-hosted Prefect server
   - Consolidates infrastructure

4. **`umami`** - Analytics (optional)
   - Umami's tables (events, sessions, websites, etc.)
   - Used by: Umami analytics dashboard
   - Separate from application data

**Naming Convention:**
- Prefix app schemas with `captionacc_` for clear project ownership
- Service schemas (like `umami`) use their service name
- PostgreSQL-friendly (no quoting needed)
- Easy to identify and manage

### Why Multi-Schema?

Using PostgreSQL schemas within a single database instead of separate databases provides:

- **Unified management**: Single backup, migration, and monitoring strategy
- **Environment isolation**: Production, staging, and services logically separated but physically co-located
- **Connection efficiency**: Same database connection, different search_path - no connection multiplexing needed
- **Infrastructure consolidation**: Application data, workflow orchestration (Prefect), and analytics (Umami) in one database
- **Cost optimization**: Multiple environments within one database instance

### Local Development vs Managed Supabase

**Local Supabase (development):**
- Uses `public` schema (default PostgreSQL schema)
- Simplest for local development
- No schema migration needed locally

**Managed Supabase (production/staging):**
- Uses named schemas only (no `public` schema for app data)
- Production: `captionacc_production`
- Staging: `captionacc_staging`
- Prefect: `captionacc_prefect` (optional)
- Analytics: `umami` (optional)

## PostgreSQL Schema Primer

In PostgreSQL, schemas are namespaces within a database:

```sql
-- Create schemas
CREATE SCHEMA captionacc_production;
CREATE SCHEMA captionacc_staging;
CREATE SCHEMA captionacc_prefect;
CREATE SCHEMA umami;

-- Tables exist in schemas
captionacc_production.videos
captionacc_staging.videos
captionacc_prefect.flow_run
umami.events

-- Set search_path to default schema
SET search_path TO captionacc_production, public;
```

## Implementation Approach

### 1. Schema Setup Migration

Create new migration that:
1. Creates `captionacc_production`, `captionacc_staging`, `captionacc_prefect`, and `umami` schemas
2. Copies current tables from `public` to `captionacc_production` (on managed instance only)
3. Replicates structure (not data) to `captionacc_staging`
4. Prepares `captionacc_prefect` schema for Prefect Server (optional)
5. Prepares `umami` schema for Umami analytics
6. **Important**: `public` schema remains unused on managed Supabase

### 2. Schema-Aware Database Client

Update Supabase client to:
- Accept `schema` parameter (default: `public`)
- Set PostgreSQL `search_path` on connection
- Example: `SET search_path TO production, public;`

### 3. Environment Configuration

Add to `.env`:
```bash
# Schema selection based on environment
SUPABASE_SCHEMA=captionacc_production  # or captionacc_staging, or public (local)
VITE_SUPABASE_SCHEMA=captionacc_production
```

### 4. Repository Updates

Update Python repositories to use schema:
```python
def get_supabase_client(schema: str = None) -> Client:
    """Get Supabase client with schema set"""
    schema = schema or os.environ.get("SUPABASE_SCHEMA", "public")
    client = create_client(url, key)

    # Set search_path for this connection
    client.postgrest.schema(schema)
    return client
```

### 5. Migration Strategy

**For Production:**
1. Create schemas in your Supabase project
2. Run migration to copy `public` → `captionacc_production`
3. Deploy updated code with `SUPABASE_SCHEMA=captionacc_production`
4. Verify production works
5. Optional: Clean up old `public` tables

**For Staging:**
1. Already has `captionacc_staging` schema (empty but structured)
2. Deploy staging with `SUPABASE_SCHEMA=captionacc_staging`
3. Seed with test data

**For Prefect (Optional):**
1. Point Prefect Server to: `postgresql://...?schema=captionacc_prefect`
2. Run Prefect database migrations to create tables
3. Alternative: Continue using Prefect Cloud (no changes needed)

**For Umami:**
1. Point Umami to: `postgresql://...?schema=umami`
2. Run Umami migrations to create analytics tables

## Detailed Implementation

### Migration: Create Multi-Schema Structure

```sql
-- File: supabase/migrations/YYYYMMDD_multi_schema_setup.sql

-- Create schemas with captionacc_ prefix
CREATE SCHEMA IF NOT EXISTS captionacc_production;
CREATE SCHEMA IF NOT EXISTS captionacc_staging;
CREATE SCHEMA IF NOT EXISTS captionacc_prefect;
CREATE SCHEMA IF NOT EXISTS umami;

-- Grant usage on schemas
GRANT USAGE ON SCHEMA captionacc_production TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA umami TO postgres, anon, authenticated, service_role;

-- Grant all privileges on tables (to be created)
GRANT ALL ON ALL TABLES IN SCHEMA captionacc_production TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA umami TO postgres, anon, authenticated, service_role;

-- Grant all privileges on sequences
GRANT ALL ON ALL SEQUENCES IN SCHEMA captionacc_production TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA captionacc_staging TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA captionacc_prefect TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA umami TO postgres, anon, authenticated, service_role;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_production GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_staging GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA captionacc_prefect GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA umami GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

-- Note: Data migration from public to captionacc_production will be done separately
-- Note: captionacc_staging will be populated with schema structure (no data)
-- Note: captionacc_prefect and umami will be populated by their respective applications
```

### Code Changes: Python Client

```python
# services/orchestrator/supabase_client.py

def get_supabase_client(
    require_production: bool = False,
    schema: str | None = None
) -> Client:
    """
    Create a Supabase client with schema support.

    Args:
        require_production: Ensure production config is used
        schema: PostgreSQL schema to use (default: from SUPABASE_SCHEMA env var)
                Options: 'public' (local), 'captionacc_production', 'captionacc_staging'

    Returns:
        Supabase client configured for specified schema
    """
    url = os.environ.get("SUPABASE_URL", LOCAL_SUPABASE_URL)
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", LOCAL_SUPABASE_SERVICE_ROLE_KEY)
    is_local = url == LOCAL_SUPABASE_URL

    # Determine schema
    if schema is None:
        schema = os.environ.get("SUPABASE_SCHEMA", "public" if is_local else "captionacc_production")

    # Safety check
    if require_production and is_local:
        raise ValueError("Production Supabase required but local detected")

    # Log connection
    env_label = "LOCAL" if is_local else "ONLINE"
    print(f"🔌 Supabase: {env_label} ({url}) [schema: {schema}]")

    client = create_client(url, key)

    # Set schema - Supabase Python client uses .schema() method
    # This sets the search_path for PostgREST queries
    client.postgrest.schema(schema)

    return client
```

### Code Changes: TypeScript Client

```typescript
// apps/captionacc-web/app/services/supabase-client.ts

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'] || LOCAL_SUPABASE_URL
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] || LOCAL_SUPABASE_ANON_KEY
const supabaseSchema = import.meta.env['VITE_SUPABASE_SCHEMA'] || 'public'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  db: {
    schema: supabaseSchema,  // Set default schema
  },
})

// Log in dev
if (import.meta.env.DEV) {
  const isLocal = supabaseUrl === LOCAL_SUPABASE_URL
  console.log(`🔌 Supabase: ${isLocal ? 'LOCAL' : 'ONLINE'} (${supabaseUrl}) [schema: ${supabaseSchema}]`)
}
```

### Environment Variables

Update `.env`:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SCHEMA=captionacc_production  # or captionacc_staging, or public (local dev)
SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_key

# For web app
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_SCHEMA=captionacc_production
VITE_SUPABASE_ANON_KEY=your_key
VITE_SUPABASE_SERVICE_ROLE_KEY=your_key
```

### Fly.io Configuration

Update `fly.toml` and workflows:

```toml
# apps/captionacc-web/fly.toml
[env]
  NODE_ENV = "production"
  ENVIRONMENT = "production"
  VITE_SUPABASE_SCHEMA = "captionacc_production"  # NEW
```

```yaml
# .github/workflows/captionacc-web-fly-deploy.yml
- name: Configure Fly.io secrets
  run: |
    flyctl secrets set \
      VITE_SUPABASE_URL="${{ secrets.SUPABASE_URL }}" \
      VITE_SUPABASE_ANON_KEY="${{ secrets.SUPABASE_ANON_KEY }}" \
      VITE_SUPABASE_SERVICE_ROLE_KEY="${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
      VITE_SUPABASE_SCHEMA="captionacc_production" \
      --app captionacc-web
```

For staging/review apps:
```bash
# Set staging schema for review apps
flyctl secrets set VITE_SUPABASE_SCHEMA="captionacc_staging" --app captionacc-web-pr-123
```

### Umami Integration

For Umami analytics (separate concern):

```bash
# Umami expects its own database or schema
# Configure Umami to use: postgresql://user:pass@host:5432/db?schema=umami

# Or in Umami's .env:
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres?schema=umami
```

### Prefect Integration

For Prefect Server (self-hosted alternative to Prefect Cloud):

```bash
# Prefect Server database connection
# Point Prefect to captionacc_prefect schema

# In Prefect Server configuration:
PREFECT_API_DATABASE_CONNECTION_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres?options=-c%20search_path%3Dcaptionacc_prefect

# Or use environment variable with schema parameter
DATABASE_URL=postgresql://...?schema=captionacc_prefect

# Run Prefect migrations to create tables in captionacc_prefect schema
prefect server database upgrade
```

## Migration Steps

### Phase 1: Prepare Migration (Local Testing)

1. Test multi-schema setup locally:
   ```bash
   # Start local Supabase
   ./scripts/start-supabase.sh

   # Create schemas locally
   psql postgresql://postgres:postgres@localhost:54322/postgres -c "
     CREATE SCHEMA captionacc_production;
     CREATE SCHEMA captionacc_staging;
     CREATE SCHEMA captionacc_prefect;
     CREATE SCHEMA umami;
   "
   ```

2. Run migration locally to verify structure

3. Test app with different schemas:
   ```bash
   # Test production schema
   SUPABASE_SCHEMA=captionacc_production npm run dev

   # Test staging schema
   SUPABASE_SCHEMA=captionacc_staging npm run dev
   ```

### Phase 2: Production Deployment

1. **Backup existing data:**
   ```bash
   supabase db dump -f backup.sql
   ```

2. **Apply migration to production Supabase:**
   ```bash
   supabase db push
   ```

4. **Deploy app with schema config:**
   ```bash
   # Set production schema
   flyctl secrets set VITE_SUPABASE_SCHEMA="captionacc_production" --app captionacc-web

   # Deploy
   git push origin main
   ```

5. **Verify production works**

6. **Clean up old public schema (optional):**
   ```sql
   DROP TABLE captionacc_production.tenants;
   DROP TABLE captionacc_production.videos;
   -- etc.
   ```

### Phase 3: Staging Setup

1. Staging schema already exists (empty structure from migration)

2. Deploy staging with schema config:
   ```bash
   flyctl secrets set VITE_SUPABASE_SCHEMA="captionacc_staging" --app captionacc-web-staging
   ```

3. Seed with test data

### Phase 4: Prefect Setup (Optional)

1. If using self-hosted Prefect Server:
   ```bash
   # Configure Prefect to use captionacc_prefect schema
   PREFECT_API_DATABASE_CONNECTION_URL=postgresql://...?options=-c%20search_path%3Dcaptionacc_prefect

   # Run Prefect migrations
   prefect server database upgrade
   ```

2. If continuing with Prefect Cloud:
   - No changes needed
   - Keep using existing Prefect Cloud configuration

### Phase 5: Umami Setup

1. Deploy Umami with connection to `umami` schema
2. Configure Umami database URL with `?schema=umami`
3. Run Umami migrations to create analytics tables

## Considerations

### RLS Policies

- RLS policies are per-table, but tables exist in different schemas
- Need to replicate RLS policies for each schema
- `auth.uid()` works across schemas (auth is global)

### Sequences

- Each schema has its own sequences (e.g., `captionacc_production.video_search_index_id_seq`)
- No conflicts between schemas

### Functions

- Functions can be in specific schemas
- Replicate functions for each application schema (production, staging)
- Service schemas (prefect, umami) manage their own functions

### Auth

- Supabase Auth is global (not per-schema)
- `user_profiles` table exists in each schema
- Same user can have different profiles in different schemas (useful for testing)

## Rollback Plan

If issues arise:

1. **Keep `public` schema untouched during transition**
2. **Deploy with `SUPABASE_SCHEMA=public` to revert**
3. **Backup before data migration**

## Design Decisions

### Schema Naming
Uses `captionacc_*` prefix for application schemas to provide clear ownership and namespace isolation. Service schemas like `umami` use their service name directly since they're self-contained systems.

Rationale:
- Clear project ownership in multi-project databases
- PostgreSQL-friendly (no identifier quoting required)
- Easy filtering and management in database tools

### Local vs Production Schema Strategy
Local development uses PostgreSQL's default `public` schema, while production/staging use named schemas (`captionacc_production`, `captionacc_staging`).

Rationale:
- Local: Minimize configuration complexity for development - standard PostgreSQL setup works out of the box
- Production: Explicit schema naming provides environment isolation and enables multiple environments in one database
- Auto-detection based on connection URL keeps code simple

### Search Path vs Qualified Names
All table references use unqualified names (e.g., `videos` not `captionacc_production.videos`), relying on PostgreSQL's `search_path` set at connection time.

Rationale:
- Cleaner code - same queries work across all schemas
- Schema switching via configuration without code changes
- Standard PostgreSQL pattern for schema-based multi-tenancy

### Prefect Server Integration
Prefect schema is optional - can use either self-hosted Prefect Server with `captionacc_prefect` schema or continue with Prefect Cloud.

Rationale:
- Consolidates infrastructure when self-hosting
- Maintains flexibility to use managed Prefect Cloud
- Schemas provide clean separation when multiple services share one database
