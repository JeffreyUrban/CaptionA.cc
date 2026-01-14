# Deployment Guide: Combined Traefik + Prefect Service

Quick guide for deploying the combined API gateway + Prefect orchestration service.

## Prerequisites

- Supabase project with service role key
- Fly.io account and CLI installed
- PostgreSQL connection string from Supabase

## Step 1: Deploy Supabase Components

### A. Run Database Migration

```bash
# From project root
cd supabase

# Push migration to create gateway_tokens table
supabase db push

# Or apply manually to production
psql $SUPABASE_DATABASE_URL -f migrations/20260113000000_gateway_tokens.sql
```

### B. Deploy Edge Function

```bash
# Deploy token generation function
supabase functions deploy generate-gateway-token

# Generate and set JWT signing secret (SAVE THIS!)
SECRET=$(openssl rand -base64 32)
echo "GATEWAY_JWT_SECRET=$SECRET"

# Set in Supabase
supabase secrets set GATEWAY_JWT_SECRET="$SECRET"
```

**Important**: Save the `GATEWAY_JWT_SECRET` - you'll need it for Fly.io!

## Step 2: Deploy to Fly.io

### A. Set Secrets

```bash
cd services/prefect-service

# Set the SAME JWT secret from Supabase
fly secrets set \
  GATEWAY_JWT_SECRET="<secret-from-step-1b>" \
  -a prefect-service

# Set Prefect database connection
# Get from: Supabase Dashboard → Settings → Database → Connection string (postgres role, not pgbouncer)
fly secrets set \
  PREFECT_API_DATABASE_CONNECTION_URL="postgresql://postgres.PROJECT:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \  # pragma: allowlist secret
  -a prefect-service
```

### B. Deploy

```bash
# First deployment
fly deploy -a prefect-service

# This will:
# 1. Build multi-stage Docker image (Traefik + Prefect)
# 2. Deploy to Fly.io
# 3. Start both services via supervisord
```

### C. Verify

```bash
# Check gateway health
curl https://prefect-service.fly.dev/ping
# Should return: OK

# Check deployment status
fly status -a prefect-service

# View logs
fly logs -a prefect-service
```

## Step 3: Generate Service Tokens

Generate JWT tokens for each service that needs to access Prefect:

```bash
# Install dependencies for token generation script
cd ../api-gateway
pip install -r requirements.txt

# Set environment variables
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Generate token for Modal workers
python generate-token.py \
  --project captionacc \
  --service modal \
  --description "Modal GPU workers accessing Prefect" \
  --expires-in-days 90

# Generate token for API service
python generate-token.py \
  --project captionacc \
  --service api \
  --description "CaptionA.cc API service" \
  --expires-in-days 90

# Generate token for Orchestrator
python generate-token.py \
  --project captionacc \
  --service orchestrator \
  --description "Orchestrator service" \
  --expires-in-days 90

# Generate token for Web app
python generate-token.py \
  --project captionacc \
  --service web \
  --description "Web application" \
  --expires-in-days 90
```

**Save these tokens!** You'll need to set them in each service's environment.

## Step 4: Configure Client Services

Update services to use the new authenticated gateway:

### For Fly.io Services (API, Orchestrator)

```bash
# Update API service
fly secrets set \
  PREFECT_API_URL="https://prefect-service.fly.dev/captionacc/prefect/api" \
  PREFECT_AUTH_TOKEN="<token-from-step-3>" \
  -a captionacc-api

# Update Orchestrator service
fly secrets set \
  PREFECT_API_URL="https://prefect-service.fly.dev/captionacc/prefect/api" \
  PREFECT_AUTH_TOKEN="<token-from-step-3>" \
  -a captionacc-orchestrator
```

### For Modal Functions

```bash
# Set Modal secrets
modal secret create PREFECT_AUTH_TOKEN="<token-from-step-3>"
modal secret create PREFECT_API_URL="https://prefect-service.fly.dev/captionacc/prefect/api"
```

### For Web App

```bash
fly secrets set \
  NEXT_PUBLIC_PREFECT_API_URL="https://prefect-service.fly.dev/captionacc/prefect/api" \
  PREFECT_AUTH_TOKEN="<token-from-step-3>" \
  -a captionacc-web
```

## Step 5: Test End-to-End

### Test Gateway Authentication

```bash
# Should fail without token
curl https://prefect-service.fly.dev/captionacc/prefect/api/health
# Expected: 401 Unauthorized

# Should succeed with token
curl https://prefect-service.fly.dev/captionacc/prefect/api/health \
  -H "Authorization: Bearer <token>"
# Expected: {"status": "ok"}
```

### Test Prefect Flow

Trigger a test flow from one of your services to verify end-to-end:

```python
from prefect import flow
from prefect.client.orchestration import get_client
import os

@flow
def test_flow():
    return "Hello from authenticated Prefect!"

async def main():
    # Uses PREFECT_API_URL and PREFECT_AUTH_TOKEN from environment
    async with get_client() as client:
        deployment = await client.read_deployment_by_name(
            "test-flow/production"
        )
        flow_run = await client.create_flow_run(
            deployment_id=deployment.id
        )
        print(f"Created flow run: {flow_run.id}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## Troubleshooting

### Service Won't Start

```bash
# SSH into container
fly ssh console -a prefect-service

# Check supervisor status
supervisorctl status
# Should show:
# traefik    RUNNING   pid 123, uptime 0:05:00
# prefect    RUNNING   pid 456, uptime 0:05:00

# Check individual services
curl http://localhost:8080/ping  # Traefik
curl http://localhost:4200/api/health  # Prefect
```

### Gateway Returns 502

Prefect may still be starting (takes 30-60s on cold start):

```bash
# Watch logs
fly logs -a prefect-service -f

# Wait for "Prefect server started" message
```

### Token Validation Fails

```bash
# Verify secrets are set
fly secrets list -a prefect-service

# Should see:
# GATEWAY_JWT_SECRET
# PREFECT_API_DATABASE_CONNECTION_URL

# Check they match Supabase
supabase secrets list
```

### Memory Issues

```bash
# Check memory usage
fly status -a prefect-service

# If consistently above 800MB, increase memory:
# Edit fly.toml: memory = "2048mb"
fly deploy -a prefect-service
```

## Monitoring

### Health Checks

```bash
# Gateway
curl https://prefect-service.fly.dev/ping

# Prefect (authenticated)
curl https://prefect-service.fly.dev/captionacc/prefect/api/health \
  -H "Authorization: Bearer <token>"
```

### Logs

```bash
# Combined logs
fly logs -a prefect-service

# Filter by service
fly logs -a prefect-service | grep "traefik"
fly logs -a prefect-service | grep "prefect"
```

### Metrics

```bash
# Prometheus metrics
curl https://prefect-service.fly.dev/metrics
```

## Next Steps

1. **Set up monitoring**: Configure alerts for service health
2. **Rotate tokens**: Set calendar reminder to rotate tokens quarterly
3. **Add more routes**: Edit `gateway/dynamic/captionacc.yml` to route other services
4. **Scale if needed**: Monitor memory usage and increase if needed

## Quick Reference

### URLs
- **Gateway Health**: `https://prefect-service.fly.dev/ping`
- **Prefect API**: `https://prefect-service.fly.dev/captionacc/prefect/api/*`
- **Prefect UI**: `https://prefect-service.fly.dev/captionacc/prefect/` (requires auth)
- **Metrics**: `https://prefect-service.fly.dev/metrics`

### Environment Variables (Client Services)
```bash
PREFECT_API_URL="https://prefect-service.fly.dev/captionacc/prefect/api"
PREFECT_AUTH_TOKEN="<your-jwt-token>"
```

### Common Commands
```bash
# Deploy
fly deploy -a prefect-service

# View logs
fly logs -a prefect-service

# SSH into container
fly ssh console -a prefect-service

# Check status
fly status -a prefect-service

# Scale memory
fly scale memory 2048 -a prefect-service

# Restart
fly apps restart prefect-service
```

## Support

For issues, see:
- **README.md**: Full documentation
- **services/api-gateway/README.md**: Gateway standalone documentation
- **Fly.io logs**: `fly logs -a prefect-service`
- **Supabase dashboard**: Check Edge Function logs
