# ✅ Supabase Setup Complete

Supabase has been configured for CaptionA.cc with account management, video cataloging, and Prefect integration.

## What Was Done

### 1. ✅ Installed Dependencies
- **@supabase/supabase-js** - Supabase JavaScript client (web app)
- **supabase** - Supabase Python client (orchestrator)
- Removed Wasabi/boto3 dependencies

### 2. ✅ Configured Supabase
- **config.toml** - Local Supabase configuration with storage buckets
- **migrations/** - Database schema with multi-tenant support
- **seed.sql** - Storage policies and demo tenant
- **Environment variables** - Already set in `.env` files

### 3. ✅ Created Storage Buckets
- **avatars** (public, 5MB) - User profile pictures
- **thumbnails** (public, 2MB) - Video thumbnails
- **videos** (private, 500MB) - Video files
- **databases** (private, 100MB) - SQLite annotation databases

All buckets have Row Level Security (RLS) policies for tenant isolation.

### 4. ✅ Built Integration Services

**TypeScript (Web App):**
- `app/services/supabase-client.ts` - Supabase client with auth helpers
- `app/services/video-upload-supabase.ts` - Video upload using Supabase Storage
- `app/types/supabase.ts` - TypeScript types for database
- `app/components/auth/` - Authentication components

**Python (Orchestrator):**
- `services/orchestrator/supabase_client.py` - Python client with repositories
- `services/orchestrator/flows/video_processing_supabase.py` - Example Prefect flow

### 5. ✅ Created Helper Scripts
- `scripts/start-supabase.sh` - One-command Supabase startup

### 6. ✅ Documentation
- `docs/SUPABASE_QUICKSTART.md` - Quick start guide
- `docs/SUPABASE_SETUP.md` - Comprehensive setup guide

## Database Schema

```sql
-- Multi-tenant support
tenants              -- Organizations/workspaces
user_profiles        -- User metadata (extends auth.users)

-- Video catalog
videos               -- Video files with processing status
video_search_index   -- Full-text search across all videos

-- Model training
training_cohorts     -- Training experiments
cohort_videos        -- Videos included in training cohorts
```

All tables have RLS enabled for tenant isolation.

## How to Start

### 1. Start Docker Desktop
Supabase runs in Docker containers.

### 2. Start Supabase
```bash
./scripts/start-supabase.sh
```

Or manually:
```bash
cd supabase
supabase start
```

### 3. Create Demo User
Open http://localhost:54323 and:
1. Go to **Authentication** > **Users**
2. Click **Add User**
3. Email: `demo@captionacc.local`, Password: `demo123456`
4. Auto Confirm: **Yes**

Then create user profile in **Table Editor** > **user_profiles**:
- id: (user UUID from step 3)
- tenant_id: `00000000-0000-0000-0000-000000000001`
- full_name: `Demo User`
- role: `admin`

### 4. Start Dev Servers

**Web App:**
```bash
cd apps/captionacc-web
npm run dev
```

**Prefect (optional):**
```bash
cd services/orchestrator
uv run python serve_flows.py
```

### 5. Test
Open http://localhost:5173 and log in with demo user.

## Architecture

```
User Browser
    │
    ├─── Auth ──────────────► Supabase Auth
    ├─── Video List ────────► Supabase DB (videos table)
    ├─── Upload Video ──────► Supabase Storage (videos bucket)
    └─── Download DB ───────► Supabase Storage (databases bucket)
                                    │
                                    ├─── Annotate Locally (SQLite)
                                    │
                                    └─── Upload Changes
                                              │
                                              ▼
                                    Prefect Flow (Process Video)
                                              │
                                              ├─── Update Supabase DB
                                              ├─── Store in Supabase Storage
                                              └─── Index for Search
```

## Key Features

### 🔐 Multi-Tenant Authentication
- Supabase Auth for user management
- RLS policies enforce tenant isolation
- Email/password authentication ready
- OAuth providers can be added in config.toml

### 📹 Video Cataloging
- Videos table tracks all uploaded videos
- Status field: uploading, processing, active, failed, etc.
- Prefect flow run tracking with `prefect_flow_run_id`
- Soft delete with `deleted_at` timestamp

### 📦 Supabase Storage
- Videos and databases stored in Supabase Storage
- RLS policies based on folder structure: `{tenant_id}/{video_id}/...`
- No external S3/Wasabi needed
- File size limits: 500MB videos, 100MB databases

### 🔍 Cross-Video Search
- `video_search_index` table with full-text search
- Automatically updated by Prefect flows
- Search across all videos in tenant
- PostgreSQL tsvector with GIN index

### 🔄 Prefect Integration
- Flows update Supabase status during processing
- Webhooks notify web app when flows complete
- Service role key bypasses RLS for system operations

## What's Different from Wasabi Setup

### Removed:
- ❌ Wasabi client code
- ❌ boto3 dependency
- ❌ External S3 configuration
- ❌ Wasabi CORS setup

### Simplified:
- ✅ Everything in Supabase (database + storage)
- ✅ Single authentication system
- ✅ Unified permission model (RLS)
- ✅ Simpler local development setup

### Trade-offs:
- **Pro**: Simpler architecture, fewer moving parts
- **Pro**: Built-in RLS for security
- **Pro**: Easier local development
- **Con**: Storage limits (100GB free tier, then paid)
- **Con**: Less control over storage infrastructure

For production with large storage needs, Wasabi can still be added back.

## Next Steps

1. ✅ **Setup Complete** - You can now start Supabase
2. ⚠️ **Start Docker** - Required before running Supabase
3. 🎯 **Create Demo User** - Follow steps above
4. 🧪 **Test Upload** - Update upload UI to use Supabase Storage
5. 🔍 **Add Search** - Build UI for `video_search_index`

## Useful Commands

```bash
# Start Supabase
./scripts/start-supabase.sh

# Check status
supabase status

# View logs
supabase logs

# Stop Supabase
supabase stop

# Reset database (deletes all data)
supabase db reset

# Generate TypeScript types
npx supabase gen types typescript --local > app/types/supabase.ts
```

## Files to Review

### Configuration
- ✅ `supabase/config.toml` - Buckets and auth settings
- ✅ `supabase/migrations/20260105024713_initial_schema.sql` - Database schema
- ✅ `supabase/seed.sql` - RLS policies and demo data
- ✅ `.env` - Environment variables

### TypeScript Integration
- ✅ `app/services/supabase-client.ts` - Client setup
- ✅ `app/services/video-upload-supabase.ts` - Upload implementation
- ✅ `app/components/auth/` - Auth UI components

### Python Integration
- ✅ `services/orchestrator/supabase_client.py` - Python client
- ✅ `services/orchestrator/flows/video_processing_supabase.py` - Example flow

## Need Help?

- **Quick Start**: `docs/SUPABASE_QUICKSTART.md`
- **Detailed Setup**: `docs/SUPABASE_SETUP.md`
- **Supabase Docs**: https://supabase.com/docs
- **Prefect Docs**: https://docs.prefect.io/

---

**Ready to start? Run: `./scripts/start-supabase.sh`**

(Make sure Docker Desktop is running first!)
