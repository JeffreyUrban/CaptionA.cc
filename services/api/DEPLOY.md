# Fly.io Deployment

## Environment Strategy

We maintain separate Fly.io apps for production and development:

| Environment | API App | Web App |
|-------------|---------|---------|
| Production | `captionacc-api-prod` | `captionacc-web-prod` |
| Development | `captionacc-api-dev` | `captionacc-web-dev` |

Each environment has its own:
- Fly.io app and volume
- Secrets (Supabase, Wasabi, Prefect, Modal credentials)
- Prefect work pool (`captionacc-workers-prod` / `captionacc-workers-dev`)
- Modal app suffix (`prod` / `dev`)

## Quick Deploy

```bash
# Production
cd services/api
fly deploy -c fly.prod.toml

# Development
cd services/api
fly deploy -c fly.dev.toml
```

## First-Time Setup

### 1. Create Apps and Volumes

**Production:**
```bash
fly apps create captionacc-api-prod
fly volumes create captionacc_data_prod --region ewr --size 1 -a captionacc-api-prod
```

**Development:**
```bash
fly apps create captionacc-api-dev
fly volumes create captionacc_data_dev --region ewr --size 1 -a captionacc-api-dev
```

### 2. Set Secrets

Each environment needs its own credentials. Use non-suffixed variable names - the environment separation happens at the app level.

**Production:**
```bash
fly secrets set \
  SUPABASE_URL="https://your-prod-project.supabase.co" \
  SUPABASE_JWT_SECRET="your-prod-jwt-secret" \
  SUPABASE_SERVICE_ROLE_KEY="your-prod-service-role-key" \
  WASABI_ACCESS_KEY_READWRITE="your-prod-access-key" \
  WASABI_SECRET_KEY_READWRITE="your-prod-secret-key" \
  WASABI_BUCKET="captionacc-prod" \
  WASABI_REGION="us-east-1" \
  PREFECT_API_URL="https://your-prefect-server/api" \
  PREFECT_API_KEY="your-prefect-api-key" \
  -a captionacc-api-prod
```

**Development:**
```bash
fly secrets set \
  SUPABASE_URL="https://your-dev-project.supabase.co" \
  SUPABASE_JWT_SECRET="your-dev-jwt-secret" \
  SUPABASE_SERVICE_ROLE_KEY="your-dev-service-role-key" \
  WASABI_ACCESS_KEY_READWRITE="your-dev-access-key" \
  WASABI_SECRET_KEY_READWRITE="your-dev-secret-key" \
  WASABI_BUCKET="captionacc-dev" \
  WASABI_REGION="us-east-1" \
  PREFECT_API_URL="https://your-prefect-server/api" \
  PREFECT_API_KEY="your-prefect-api-key" \
  -a captionacc-api-dev
```

### 3. Deploy

```bash
# Production
fly deploy -c fly.prod.toml

# Development
fly deploy -c fly.dev.toml
```

## Configuration Files

| File | Purpose |
|------|---------|
| `fly.prod.toml` | Production Fly.io config |
| `fly.dev.toml` | Development Fly.io config |
| `prefect.yaml` | Production Prefect deployments |
| `prefect-dev.yaml` | Development Prefect deployments |

Key differences between environments:
- `ENVIRONMENT`: `production` vs `development`
- `MODAL_APP_SUFFIX`: `prod` vs `dev`
- Volume: `captionacc_data_prod` vs `captionacc_data_dev`
- Prefect work pool: `captionacc-workers-prod` vs `captionacc-workers-dev`
- Supabase: Separate projects (different `SUPABASE_URL`), same schema name (`captionacc`)

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
6. Deploy: `fly deploy -c fly.prod.toml`

## Useful Commands

```bash
# Check status
fly status -a captionacc-api-prod
fly status -a captionacc-api-dev

# View logs
fly logs -a captionacc-api-prod
fly logs -a captionacc-api-dev

# SSH into machine
fly ssh console -a captionacc-api-prod

# Check secrets (names only)
fly secrets list -a captionacc-api-prod

# Check volume
fly volumes list -a captionacc-api-prod

# Restart
fly machines restart -a captionacc-api-prod
```

## Migration from Single App

If migrating from the old single `captionacc-api` app:

1. Create the new prod app and volume (see above)
2. Set secrets on the new app
3. Deploy to the new app: `fly deploy -c fly.prod.toml`
4. Update DNS/load balancer to point to new app
5. (Optional) Stop the old app: `fly apps destroy captionacc-api`
