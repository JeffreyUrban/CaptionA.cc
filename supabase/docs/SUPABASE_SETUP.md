# Supabase Setup for CaptionA.cc

This guide walks through setting up Supabase for account management, video cataloging, and Prefect integration.

## Architecture Overview

CaptionA.cc uses a hybrid storage approach:

- **Supabase (PostgreSQL)**: Multi-tenant catalog, user management, metadata, search index
- **Wasabi (S3)**: Large file storage for videos, frames, and annotation databases
- **SQLite**: Per-video annotation database (stored in Wasabi, used locally during annotation)
- **Prefect**: Workflow orchestration that updates both Supabase and SQLite

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       ├─── Auth ────────────► Supabase Auth
       ├─── Video List ──────► Supabase (videos table)
       ├─── Upload Video ────► Wasabi + Supabase catalog entry
       └─── Annotation ──────► SQLite (downloaded from Wasabi)
                                    │
                                    ├─── On Save: Update SQLite
                                    └─── Prefect Flow Updates: Supabase + Wasabi
```

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Wasabi account with credentials in `.env`
- Python 3.11+ with `uv`
- Node.js 20+ for web app

## Step 1: Start Local Supabase

```bash
# Navigate to project root
cd /Users/jurban/PycharmProjects/CaptionA.cc-claude3

# Start Supabase (downloads Docker images on first run)
cd supabase
supabase start
```

This will:
- Start PostgreSQL, PostgREST, GoTrue (auth), and other services
- Apply migrations from `supabase/migrations/`
- Run seed data from `supabase/seed.sql`

Output will show connection details:
```
API URL: http://localhost:54321
DB URL: postgresql://postgres:postgres@localhost:54322/postgres
Studio URL: http://localhost:54323
anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Step 2: Verify Supabase Database

```bash
# Open Supabase Studio
open http://localhost:54323

# Or connect via psql
psql postgresql://postgres:postgres@localhost:54322/postgres
```

Check that tables exist:
```sql
\dt public.*

-- Should see:
-- tenants
-- user_profiles
-- videos
-- training_cohorts
-- cohort_videos
-- video_search_index
```

## Step 3: Configure Wasabi Storage

```bash
# Ensure .env has Wasabi credentials
cat .env | grep WASABI

# Apply CORS configuration
python scripts/setup_wasabi.py
```

This will:
- Verify bucket access
- Apply CORS rules for browser uploads
- Test upload/download

## Step 4: Install Dependencies

### Python (Orchestrator)
```bash
cd services/orchestrator
uv sync
```

This installs:
- `supabase>=2.0.0` - Python client
- `boto3>=1.34.0` - Wasabi/S3 client
- `prefect>=3.0.0` - Workflow orchestration

### TypeScript (Web App)
```bash
cd apps/captionacc-web
npm install --save @supabase/supabase-js
```

## Step 5: Create Demo User

### Option A: Via Supabase Studio
1. Open http://localhost:54323
2. Go to Authentication > Users
3. Click "Add User"
4. Email: `demo@captionacc.local`
5. Password: `demo123456`
6. Auto Confirm: Yes

### Option B: Via SQL
```sql
-- Connect to Supabase DB
psql postgresql://postgres:postgres@localhost:54322/postgres

-- Create user (bypasses email confirmation)
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'demo@captionacc.local',
  crypt('demo123456', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW()
) RETURNING id;

-- Create user profile (use the UUID from above)
INSERT INTO public.user_profiles (
  id,
  tenant_id,
  full_name,
  role
) VALUES (
  '<user-id-from-above>',
  '00000000-0000-0000-0000-000000000001', -- Demo tenant from seed.sql
  'Demo User',
  'admin'
);
```

## Step 6: Start Development Servers

### Terminal 1: Web App
```bash
cd apps/captionacc-web
npm run dev
```

Runs on http://localhost:5173

### Terminal 2: Prefect Orchestrator
```bash
cd services/orchestrator
source .env
uv run python serve_flows.py
```

### Terminal 3: Prefect Worker (optional, for background jobs)
```bash
cd services/orchestrator
source .env
uv run prefect worker start --pool default
```

## Step 7: Test End-to-End Flow

### 1. Sign In
- Navigate to http://localhost:5173/auth/login
- Sign in with demo user credentials
- Should redirect to videos list

### 2. Upload Video (TODO: Update upload UI)
Currently the upload flow needs to be updated to use the new Supabase integration.

**Expected flow:**
1. User selects video file
2. Client calls `createVideoEntry()` to create Supabase record
3. Client uploads video to Wasabi using pre-signed URL
4. Client calls `finalizeVideoUpload()` to queue Prefect flow
5. Prefect flow:
   - Updates Supabase status: `processing`
   - Extracts frames and runs OCR
   - Updates Supabase status: `active`
   - Indexes content in `video_search_index`
6. SSE webhook notifies browser
7. Video appears in list with status "Active"

### 3. Verify Supabase Updates

Check video record:
```sql
SELECT id, filename, status, prefect_flow_run_id, uploaded_at
FROM videos
ORDER BY uploaded_at DESC
LIMIT 5;
```

Check search index:
```sql
SELECT video_id, frame_index, ocr_text
FROM video_search_index
WHERE video_id = '<video-id>'
LIMIT 10;
```

### 4. Test Cross-Video Search

```sql
-- Full-text search for Chinese text
SELECT v.filename, s.frame_index, s.ocr_text
FROM video_search_index s
JOIN videos v ON s.video_id = v.id
WHERE s.search_vector @@ to_tsquery('simple', '字幕')
LIMIT 20;
```

## Troubleshooting

### Supabase won't start
```bash
# Check Docker is running
docker ps

# Reset Supabase
supabase stop
supabase start --reset
```

### Migration errors
```bash
# Check migration status
supabase db diff

# Reset and reapply
supabase db reset
```

### Prefect can't connect to Supabase
```bash
# Check environment variables
cd services/orchestrator
source .env
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection
uv run python -c "from supabase_client import get_supabase_client; print(get_supabase_client())"
```

### Wasabi upload fails
```bash
# Test Wasabi connection
python scripts/setup_wasabi.py

# Check CORS configuration
aws s3api get-bucket-cors \
  --bucket caption-acc-prod \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

## Production Deployment

### 1. Create Supabase Project
1. Go to https://supabase.com/dashboard
2. Create new project
3. Copy connection details

### 2. Update Environment Variables
```bash
# .env (production)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key-from-dashboard>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

### 3. Apply Migrations
```bash
# Link to production project
supabase link --project-ref <project-ref>

# Push migrations
supabase db push
```

### 4. Configure Wasabi CORS
Update `wasabi/cors.json` with production domains:
```json
{
  "AllowedOrigins": [
    "https://app.captionacc.com",
    "https://*.fly.dev"
  ]
}
```

Then apply:
```bash
python scripts/setup_wasabi.py
```

## Next Steps

1. **Update Upload UI**: Modify upload components to use `video-upload-supabase.ts`
2. **Add User Management**: Create admin UI for managing tenants and users
3. **Implement Search**: Add cross-video search UI using `video_search_index`
4. **Training Cohorts**: Integrate cohort management with model training flows
5. **Analytics**: Add usage tracking and quota monitoring

## Files Reference

### Configuration
- `supabase/config.toml` - Supabase local dev config
- `supabase/migrations/20260105024713_initial_schema.sql` - Database schema
- `supabase/seed.sql` - Demo data and storage policies
- `.env` - Environment variables (Supabase + Wasabi)

### TypeScript (Web App)
- `app/services/supabase-client.ts` - Supabase client and auth helpers
- `app/services/video-upload-supabase.ts` - Video upload with Supabase catalog
- `app/types/supabase.ts` - TypeScript types for database
- `app/components/auth/` - Authentication components

### Python (Orchestrator)
- `services/orchestrator/supabase_client.py` - Supabase Python client
- `services/orchestrator/wasabi_client.py` - Wasabi S3 client
- `services/orchestrator/flows/video_processing_supabase.py` - Example flow with Supabase
- `scripts/setup_wasabi.py` - Wasabi bucket setup script
