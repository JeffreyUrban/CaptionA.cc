# Supabase Quick Start Guide

This is a simplified guide for setting up Supabase for CaptionA.cc with Supabase Storage (no external S3/Wasabi needed).

## Prerequisites

- Docker Desktop installed and running
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Node.js 20+ and Python 3.11+

## Quick Setup

### 1. Start Docker Desktop
Make sure Docker Desktop is running before proceeding.

### 2. Start Supabase

```bash
# Use the convenience script
./scripts/start-supabase.sh

# Or manually:
cd supabase
supabase start
```

This will:
- Download Supabase Docker images (first time only)
- Start all Supabase services (PostgreSQL, Auth, Storage, etc.)
- Apply database migrations
- Run seed data to create storage buckets and demo tenant

### 3. Access Supabase Studio

Open http://localhost:54323 in your browser.

Default credentials are shown in the terminal output.

### 4. Create a Demo User

In Supabase Studio:
1. Go to **Authentication** > **Users**
2. Click **Add User**
3. Fill in:
   - Email: `demo@captionacc.local`
   - Password: `demo123456`
   - Auto Confirm: **Yes**
4. Click **Create User**

Then add the user profile:
1. Go to **Table Editor** > **user_profiles**
2. Click **Insert** > **Insert row**
3. Fill in:
   - id: (copy the UUID from the user you just created)
   - tenant_id: `00000000-0000-0000-0000-000000000001` (demo tenant)
   - full_name: `Demo User`
   - role: `admin`
4. Click **Save**

### 5. Install Dependencies

```bash
# Python orchestrator dependencies
cd services/orchestrator
uv sync

# Web app dependencies (already done)
cd apps/captionacc-web
npm install
```

### 6. Start Development Servers

**Terminal 1 - Web App:**
```bash
cd apps/captionacc-web
npm run dev
```

**Terminal 2 - Prefect (optional):**
```bash
cd services/orchestrator
uv run python serve_flows.py
```

### 7. Test the Setup

1. Open http://localhost:5173
2. You should see the CaptionA.cc app
3. Try logging in with the demo user credentials

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   CaptionA.cc                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Web App (React Router)                             │
│    ├── Authentication ──────────► Supabase Auth     │
│    ├── Video Catalog ───────────► Supabase DB       │
│    ├── Video Upload ────────────► Supabase Storage  │
│    └── Annotations ──────────────► SQLite (local)   │
│                                         │            │
│  Prefect Orchestrator                   │            │
│    ├── Process Videos ──────────────────┘            │
│    ├── Update Catalog ──────────► Supabase DB       │
│    └── Store Results ───────────► Supabase Storage  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Storage Buckets

Supabase Storage has four buckets configured:

1. **avatars** (public) - User profile pictures
2. **thumbnails** (public) - Video thumbnails
3. **videos** (private) - Uploaded video files (up to 500MB each)
4. **databases** (private) - SQLite annotation databases (up to 100MB each)

All buckets have RLS policies that enforce tenant isolation based on the folder structure:
```
{tenant_id}/{video_id}/video.mp4
{tenant_id}/{video_id}/annotations.db
```

## Database Schema

### Core Tables

- **tenants** - Organizations/workspaces
- **user_profiles** - User metadata (extends auth.users)
- **videos** - Video catalog with processing status
- **training_cohorts** - Model training experiments
- **cohort_videos** - Many-to-many: videos ↔ cohorts
- **video_search_index** - Full-text search across all videos

### Row Level Security (RLS)

All tables have RLS enabled with policies that:
- Restrict users to their own tenant's data
- Prevent data leakage between tenants
- Allow service role access for Prefect workflows

## Environment Variables

The `.env` file is already configured with local development settings:

```bash
# Supabase (local development defaults)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Public env vars for web app
PUBLIC_SUPABASE_URL=http://localhost:54321
PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

These are the default keys for local Supabase and are safe to commit.

## Troubleshooting

### Supabase won't start
```bash
# Check Docker is running
docker ps

# Stop and restart Supabase
supabase stop
supabase start
```

### Can't access Studio
Make sure port 54323 is not in use:
```bash
lsof -i :54323
```

### Migration errors
```bash
# Reset the database
supabase db reset
```

### Need to see logs
```bash
# View all logs
supabase logs

# View specific service
supabase logs postgres
supabase logs auth
supabase logs storage
```

## Next Steps

1. **Add Authentication UI** - Integrate the auth components in `app/components/auth/`
2. **Update Upload Flow** - Use `video-upload-supabase.ts` for video uploads
3. **Test Video Processing** - Upload a video and verify Prefect integration
4. **Add Search UI** - Query the `video_search_index` for cross-video search
5. **Configure Production** - Create a Supabase Cloud project for deployment

## Files Reference

### Configuration
- `supabase/config.toml` - Supabase configuration
- `supabase/migrations/` - Database schema migrations
- `supabase/seed.sql` - Demo data and storage policies
- `.env` - Environment variables

### Scripts
- `scripts/start-supabase.sh` - Convenient startup script

### TypeScript (Web App)
- `app/services/supabase-client.ts` - Supabase client
- `app/services/video-upload-supabase.ts` - Video upload with Supabase Storage
- `app/types/supabase.ts` - Database types
- `app/components/auth/` - Auth components

### Python (Orchestrator)
- `services/orchestrator/supabase_client.py` - Python Supabase client
- `services/orchestrator/flows/video_processing_supabase.py` - Example flow

## Stop Supabase

When you're done developing:

```bash
cd supabase
supabase stop
```

This stops all Supabase services but preserves your data.

To completely reset (delete all data):

```bash
supabase db reset
```
