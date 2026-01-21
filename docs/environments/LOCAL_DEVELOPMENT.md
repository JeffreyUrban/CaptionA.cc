# Local Development Guide

This guide explains how to run the CaptionA.cc API locally with full namespace isolation from production.

## Overview

Local development uses a `dev` namespace to isolate all services from production:

| Service | Production | Development |
|---------|------------|-------------|
| Supabase schema | `captionacc_prod` | `captionacc_dev` |
| Prefect work pool | `captionacc-workers-prod` | `captionacc-workers-dev` |
| Prefect deployments | `captionacc-prod-*` | `captionacc-dev-*` |
| Modal apps | `*-prod` | `*-dev` |

## Quick Start

### Automated Setup

Run the setup script:

```bash
cd services/api
./scripts/setup-local-dev.sh
```

This will:
1. Create `.env` from `.env.development.template`
2. Guide you through Supabase schema setup
3. Register dev Prefect deployments
4. Deploy dev Modal apps

### Manual Setup

#### 1. Environment Configuration

```bash
cd services/api
cp .env.development.template .env
# Edit .env and fill in credentials
```

Key settings:
- `CAPTIONACC_NAMESPACE=dev` - Enables dev namespace isolation
- `SUPABASE_SCHEMA=captionacc_dev` - Uses dev schema

#### 2. Supabase Schema

The dev schema is created via migrations (already applied):

```bash
cd supabase
supabase db push
```

Migrations applied:
- `20260120000000_rename_schema_to_prod.sql` - Renames `captionacc_production` → `captionacc_prod`
- `20260120000001_create_dev_schema.sql` - Creates `captionacc_dev` with all tables/functions/RLS
- `20260120000002_auth_trigger_multi_schema.sql` - Auth trigger creates profiles in both schemas

#### 3. Prefect Deployments

Register dev deployments:

```bash
cd services/api
PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api \
  prefect deploy --all --prefect-file prefect-dev.yaml
```

#### 4. Modal Apps

Deploy dev Modal apps:

```bash
# extract-full-frames-and-ocr-dev
cd data-pipelines/extract-full-frames-and-ocr
modal_app_suffix=dev modal deploy src/extract_full_frames_and_ocr/app.py

# extract-crop-frames-and-infer-extents-dev
cd data-pipelines/extract-crop-frames-and-infer-extents
modal_app_suffix=dev modal deploy src/extract_crop_frames_and_infer_extents/app.py
```

## Running the API

```bash
cd services/api
uvicorn app.main:app --reload
```

Check logs for: `Starting Prefect worker for work pool 'captionacc-workers-dev'`

## Verification

### Config Verification

```bash
cd services/api
CAPTIONACC_NAMESPACE=dev python -c "from app.config import get_settings; s=get_settings(); print(s.effective_work_pool, s.modal_app_suffix)"
# Should print: captionacc-workers-dev dev
```

### Prefect Verification

```bash
prefect deployment ls | grep dev
```

### Modal Verification

```bash
modal app list | grep dev
```

## Web App Configuration

For the web app, create `apps/captionacc-web/.env.development`:

```bash
# Point to local API
VITE_API_URL=http://localhost:8000

# Supabase (same project, RLS handles access control)
VITE_SUPABASE_URL=https://stbnsczvywpwjzbpfehp.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

## Architecture

### What Gets Namespaced

1. **Supabase Schema** - Complete data isolation via separate schemas
2. **Prefect Work Pool** - Flows execute in isolated worker pool
3. **Prefect Deployments** - Separate deployment definitions
4. **Modal Apps** - GPU functions deployed with `-dev` suffix

### What Is Shared

1. **Wasabi Bucket** - Same bucket, tenant ID provides data isolation
2. **Supabase Project** - Same project, different schema
3. **Prefect Server** - Same server, different work pools
4. **Modal Account** - Same account, different app names

## Supabase Configuration

### Edge Functions

Edge Functions are duplicated for prod/dev isolation:

| Function | Environment | Description |
|----------|-------------|-------------|
| `captionacc-presigned-upload-prod` | Production | Uses `DB_SCHEMA` → `captionacc_prod` |
| `captionacc-presigned-upload-dev` | Development | Uses `DB_SCHEMA` → `captionacc_dev` |
| `captionacc-s3-credentials-prod` | Production | Uses `DB_SCHEMA` → `captionacc_prod` |
| `captionacc-s3-credentials-dev` | Development | Uses `DB_SCHEMA` → `captionacc_dev` |

### Edge Function Secrets

**Production secrets (already configured):**
```bash
supabase secrets set DB_SCHEMA=captionacc_prod
supabase secrets set WASABI_BUCKET=captionacc-prod
```

**Development secrets (need to be set):**
```bash
supabase secrets set DB_SCHEMA=captionacc_dev
```

### Video Processing

When a video is uploaded, processing starts immediately via Supabase Realtime:

**Primary mechanism (immediate):**
- API subscribes to `videos` table INSERT events via Supabase Realtime
- On INSERT, triggers `process_new_videos` flow immediately
- Expected latency: seconds

**Recovery fallback (every 15 minutes):**
- Cron job queries for any videos with `layout_status = 'wait'`
- Catches missed Realtime events (network issues, API restart, etc.)

Both mechanisms use the same `process_new_videos` flow with built-in race condition protection.

This architecture:
- Provides immediate processing as the standard flow
- Works identically in dev and prod (no webhook configuration needed)
- Decouples the API from Supabase knowing its URL

### Auth & User Profiles

When users sign up, the auth trigger creates profiles in **both** schemas:
- `captionacc_prod.user_profiles`
- `captionacc_dev.user_profiles`

This ensures users can work seamlessly in both environments.

## Troubleshooting

### Worker Not Starting

Check `PREFECT_API_URL` is set correctly in `.env`.

### Modal Function Not Found

Ensure Modal apps are deployed with `modal_app_suffix=dev`:

```bash
modal app list | grep extract
```

### Database Errors

Verify `SUPABASE_SCHEMA=captionacc_dev` and the schema exists.

### User Profile Not Found

If you get "User profile not found" errors in dev:
1. Check that `captionacc_dev.user_profiles` has your user
2. The auth trigger backfill should have created profiles for existing users
3. New users automatically get profiles in both schemas
