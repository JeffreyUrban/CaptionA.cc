# Supabase Configuration Guide

CaptionA.cc supports both local Supabase (development) and online Supabase (production, CI, staging).

## Local Development

Start local Supabase:

```bash
./scripts/start-supabase.sh
```

The `.env` file contains Supabase's standard demo keys for localhost:54321.

Access Supabase Studio: http://localhost:54323

## Demo Keys

Local development uses Supabase's standard demo keys:

- Documented at https://supabase.com/docs/guides/cli/local-development
- Only work with `supabase start` on localhost:54321

Production keys are stored in secrets (GitHub Secrets, Fly.io Secrets).

## Using Online Supabase

### Prerequisites

1. Supabase project created at https://app.supabase.com
2. Database schema migrated (see below)
3. API credentials from project settings

### Get Credentials

1. Go to https://app.supabase.com/project/YOUR_PROJECT/settings/api
2. Copy:
   - **Project URL** (e.g., `https://abc123.supabase.co`)
   - **anon public** key (client-side operations)
   - **service_role secret** key (server-side, bypasses RLS)

### Configure Environment

Update `.env` file:

```bash
# Online Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SCHEMA=captionacc_prod
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Vite variables (web app)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_SCHEMA=captionacc_prod
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Note: `.env` is gitignored.

### Run Migrations

Link Supabase CLI to the online project:

```bash
# Link to project (one-time setup)
supabase link --project-ref your-project-ref

# Push schema to online database
supabase db push
```

Get `project-ref` from:
- Project URL: `https://YOUR-PROJECT-REF.supabase.co`
- Dashboard: Project Settings > General > Reference ID

## CI/CD Configuration

### GitHub Secrets

Add secrets to repository:

```bash
gh secret set SUPABASE_URL
gh secret set SUPABASE_ANON_KEY
gh secret set SUPABASE_SERVICE_ROLE_KEY
```

Use production Supabase credentials (not demo keys).

### GitHub Actions

The workflows in `.github/workflows/` will automatically:
1. Configure Fly.io secrets before deployment
2. Deploy with production Supabase credentials

## Fly.io Deployment

### Set Secrets for Web App

```bash
flyctl secrets set \
  VITE_SUPABASE_URL="https://your-project.supabase.co" \
  VITE_SUPABASE_ANON_KEY="your_anon_key" \
  VITE_SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" \
  --app captionacc-web
```

### Set Secrets for Orchestrator

```bash
flyctl secrets set \
  SUPABASE_URL="https://your-project.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" \
  PREFECT_API_URL="your_prefect_url" \
  PREFECT_API_KEY="your_prefect_key" \
  WASABI_ACCESS_KEY_READWRITE="your_key" \
  WASABI_SECRET_KEY_READWRITE="your_secret" \
  WASABI_BUCKET="your-bucket" \
  WASABI_REGION="us-east-1" \
  ENVIRONMENT="production" \
  --app captionacc-orchestrator
```

### View Current Secrets

```bash
flyctl secrets list --app captionacc-web
flyctl secrets list --app captionacc-orchestrator
```

Secrets are encrypted and only show as "set" or "not set" in the list.

## Environment Variables Reference

### For Python Services (Orchestrator)

| Variable | Description | Local Default | Production |
|----------|-------------|---------------|------------|
| `SUPABASE_URL` | Supabase API URL | `http://localhost:54321` | Your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) | Demo key | Your service role key |
| `ENVIRONMENT` | Environment name | `dev` | `production` |

### For Web App (Vite)

| Variable | Description | Local Default | Production |
|----------|-------------|---------------|------------|
| `VITE_SUPABASE_URL` | Supabase API URL | `http://localhost:54321` | Your project URL |
| `VITE_SUPABASE_ANON_KEY` | Anonymous/public key | Demo key | Your anon key |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | Service role key (SSR only) | Demo key | Your service role key |

## Troubleshooting

### Local Development Issues

**Web app can't connect to Supabase**
```bash
# Check Supabase is running
supabase status

# Should show services on localhost:54321
# If not, start it:
./scripts/start-supabase.sh
```

**"Failed to fetch" errors**
- Verify `.env` has correct `VITE_SUPABASE_URL` (not just `SUPABASE_URL`)
- Check browser console for which URL it's trying to use
- Restart dev server after changing `.env`

### Production Issues

**Deployed app shows "Invalid API key"**
```bash
# Verify secrets are set
flyctl secrets list --app captionacc-web

# Check app logs for connection attempts
flyctl logs --app captionacc-web
```

**CORS errors in production**
1. Go to Supabase dashboard: Settings > API > URL Configuration
2. Add your Fly.io domain (e.g., `https://captionacc-web.fly.dev`)
3. Save and wait ~30 seconds for changes to propagate

**Database migrations not applied**
```bash
# Check current migration status
supabase db remote status

# Apply pending migrations
supabase db push
```

### CI/CD Issues

**GitHub Actions deployment fails**
1. Verify GitHub Secrets are set: Repository Settings > Secrets and variables > Actions
2. Check secrets match your Supabase dashboard exactly (no extra spaces/newlines)
3. Review GitHub Actions logs for specific error messages

**Secrets not updating in Fly.io**
```bash
# Redeploy after setting secrets
flyctl deploy --app captionacc-web
```

## Security Best Practices

1. **Never commit `.env`** - Already in `.gitignore`
2. **Service role keys are powerful** - They bypass Row Level Security (RLS)
   - Only use server-side (orchestrator, SSR)
   - Never expose to browser/client code
3. **Rotate keys if compromised**
   - Generate new keys in Supabase dashboard
   - Update in GitHub Secrets and Fly.io
   - Redeploy applications
4. **Demo keys are safe locally** - Only work on localhost:54321

## Switching Between Environments

### Switch to Local

```bash
# Edit .env to use localhost
SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_URL=http://localhost:54321
# (use demo keys)

# Start local Supabase
./scripts/start-supabase.sh

# Start dev servers
npm run dev
```

### Switch to Production

```bash
# Edit .env to use online Supabase
SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_URL=https://your-project.supabase.co
# (use production keys)

# Start dev servers - they'll connect to production
npm run dev
```

**Warning:** Be careful when running locally against production - you could modify production data!

## Additional Resources

- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- [Environment Variables in Vite](https://vitejs.dev/guide/env-and-mode.html)
- [Fly.io Secrets](https://fly.io/docs/reference/secrets/)
