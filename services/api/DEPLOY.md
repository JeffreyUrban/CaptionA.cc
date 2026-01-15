# Fly.io Deployment

## Quick Deploy

```bash
cd services/api
flyctl deploy
```

## First-Time Setup

### 1. Create App and Volume

```bash
flyctl apps create captionacc-api
flyctl volumes create captionacc_data --region ewr --size 1 -a captionacc-api
```

**Volume notes:**
- Volume stores CR-SQLite working copies at `/data/working/`
- Must be in same region as app (`ewr`)
- Single volume is correct for single-writer lock model
- If host fails, Fly migrates the volume (brief downtime, data safe)

### 2. Set Secrets

From project root (reads from `.env`):

```bash
cd services/api
SUPABASE_URL=$(grep '^SUPABASE_URL=' ../../.env | cut -d'=' -f2-) && \
SUPABASE_JWT_SECRET=$(grep '^SUPABASE_JWT_SECRET=' ../../.env | cut -d'=' -f2-) && \
SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' ../../.env | cut -d'=' -f2-) && \
WASABI_ACCESS_KEY=$(grep '^WASABI_ACCESS_KEY_READWRITE=' ../../.env | cut -d'=' -f2-) && \
WASABI_SECRET_KEY=$(grep '^WASABI_SECRET_KEY_READWRITE=' ../../.env | cut -d'=' -f2-) && \
WASABI_BUCKET=$(grep '^WASABI_BUCKET=' ../../.env | cut -d'=' -f2-) && \
flyctl secrets set \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_JWT_SECRET="$SUPABASE_JWT_SECRET" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  WASABI_ACCESS_KEY_ID="$WASABI_ACCESS_KEY" \
  WASABI_SECRET_ACCESS_KEY="$WASABI_SECRET_KEY" \
  WASABI_BUCKET="$WASABI_BUCKET" \
  -a captionacc-api
```

### 3. Deploy

```bash
flyctl deploy
```

## CR-SQLite Extension

The Dockerfile downloads the CR-SQLite extension from GitHub during build:

```dockerfile
ARG CRSQLITE_RELEASE_TAG=prebuild-test.main-438663b8
```

**To update the extension:**
1. Check https://github.com/superfly/cr-sqlite/releases for new versions
2. Update `CRSQLITE_RELEASE_TAG` in `Dockerfile`
3. Update `RELEASE_TAG` in `extensions/download.sh`
4. Run `./extensions/download.sh all` locally to test
5. Run `./extensions/upload-to-wasabi.sh <new-tag>` to backup to Wasabi
6. Deploy: `flyctl deploy`

**Wasabi mirror** (private backup): `s3://caption-acc-prod/artifacts/cr-sqlite/`

## Useful Commands

```bash
# Check status
flyctl status -a captionacc-api

# View logs
flyctl logs -a captionacc-api

# SSH into machine
flyctl ssh console -a captionacc-api

# Check volume
flyctl volumes list -a captionacc-api

# Restart
flyctl machines restart -a captionacc-api
```

## Configuration

Key settings in `fly.toml`:
- `primary_region = "ewr"` - Newark, must match volume region
- `auto_stop_machines = "stop"` - Stops when idle to save costs
- `min_machines_running = 1` - Keeps one machine warm

Environment variables set via `[env]` in fly.toml (non-secret) or `flyctl secrets` (secret).
