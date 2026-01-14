# API Gateway Migration Guide

This guide walks through deploying the API gateway and updating CaptionA.cc services to use authenticated access to Prefect.

## Overview

**Before:**
```
Services → https://prefect-service.fly.dev/api/* (public, unauthenticated)
```

**After:**
```
Services → https://api-gateway.fly.dev/captionacc/prefect/api/* (authenticated)
           ↓ (JWT validation)
           → prefect-service.internal:4200 (internal only)
```

## Prerequisites

- Supabase project with service role key
- Fly.io CLI installed and authenticated
- Python 3.9+ (for token generation script)

## Step-by-Step Deployment

### 1. Deploy Supabase Components

#### a. Run Migration

```bash
# Apply the gateway_tokens migration
supabase db push

# Or if using migrations file directly
psql $DATABASE_URL -f supabase/migrations/20260113000000_gateway_tokens.sql
```

#### b. Deploy Edge Function

```bash
# Deploy the token generation function
supabase functions deploy generate-gateway-token

# Set the JWT signing secret (generate a strong random secret first)
supabase secrets set GATEWAY_JWT_SECRET="$(openssl rand -base64 32)"
```

**Important:** Save this secret! You'll need it for Traefik configuration.

### 2. Deploy API Gateway to Fly.io

```bash
cd services/api-gateway

# Create the Fly.io app (first time only)
fly launch --no-deploy

# Set the JWT signing secret (use the SAME secret from Supabase)
fly secrets set GATEWAY_JWT_SECRET="your-secret-from-step-1b" -a api-gateway  # pragma: allowlist secret

# Deploy
fly deploy -a api-gateway

# Verify deployment
curl https://api-gateway.fly.dev/ping
# Should return: OK
```

### 3. Update Prefect Service

```bash
cd services/prefect-service

# Redeploy with internal-only configuration
fly deploy -a prefect-service

# Verify it's NOT publicly accessible
curl https://prefect-service.fly.dev/api/health
# Should return: connection refused or 404 (expected)

# Verify it IS accessible internally via gateway
curl https://api-gateway.fly.dev/captionacc/prefect/api/health \
  -H "Authorization: Bearer <token-from-step-4>"
# Should return: {"status": "ok"}
```

### 4. Generate Service Tokens

Generate a token for each service that needs to access Prefect:

```bash
cd services/api-gateway

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Generate token for API service
python generate-token.py \
  --project captionacc \
  --service api \
  --description "CaptionA.cc API service" \
  --expires-in-days 90

# Generate token for Orchestrator service
python generate-token.py \
  --project captionacc \
  --service orchestrator \
  --description "CaptionA.cc Orchestrator service" \
  --expires-in-days 90

# Generate token for Modal workers
python generate-token.py \
  --project captionacc \
  --service modal \
  --description "Modal GPU workers" \
  --expires-in-days 90

# Generate token for Web app
python generate-token.py \
  --project captionacc \
  --service web \
  --description "Web application" \
  --expires-in-days 90
```

**Save these tokens securely!** You'll need them in the next step.

### 5. Update Client Services

#### a. API Service

```bash
cd services/api

# Update environment variables
fly secrets set \
  PREFECT_API_URL="https://api-gateway.fly.dev/captionacc/prefect/api" \
  PREFECT_AUTH_TOKEN="<token-from-step-4-api>" \
  -a captionacc-api

# Redeploy
fly deploy -a captionacc-api
```

**Code changes needed:**
```python
# services/api/app/prefect_runner.py

import httpx
from prefect.client.orchestration import get_client

# Update client creation to include auth header
async def get_prefect_client():
    """Get authenticated Prefect client"""
    auth_token = os.getenv("PREFECT_AUTH_TOKEN")

    return get_client(
        api_url=os.getenv("PREFECT_API_URL"),
        headers={"Authorization": f"Bearer {auth_token}"} if auth_token else {}
    )
```

#### b. Orchestrator Service

```bash
cd services/orchestrator

# Update environment variables
fly secrets set \
  PREFECT_API_URL="https://api-gateway.fly.dev/captionacc/prefect/api" \
  PREFECT_AUTH_TOKEN="<token-from-step-4-orchestrator>" \
  -a captionacc-orchestrator

# Redeploy
fly deploy -a captionacc-orchestrator
```

#### c. Modal Functions

Update Modal secrets:

```bash
# Set the token in Modal
modal secret create PREFECT_AUTH_TOKEN="<token-from-step-4-modal>"

# Update PREFECT_API_URL if not already set
modal secret create PREFECT_API_URL="https://api-gateway.fly.dev/captionacc/prefect/api"
```

**Code changes needed:**
```python
# In your Modal function code
import os
from prefect import flow
from prefect.client.orchestration import get_client

@app.function(
    secrets=[
        modal.Secret.from_name("prefect-credentials"),
    ]
)
async def some_modal_function():
    # Prefect client will automatically use PREFECT_API_URL and PREFECT_AUTH_TOKEN
    # from environment variables
    async with get_client() as client:
        # ... your code
```

#### d. Web Application

Update web app environment variables:

```typescript
// apps/captionacc-web/app/services/prefect.ts

const PREFECT_API_URL = process.env.PREFECT_API_URL ||
  'https://api-gateway.fly.dev/captionacc/prefect/api';
const PREFECT_AUTH_TOKEN = process.env.PREFECT_AUTH_TOKEN || '';

export async function queuePrefectFlow(
  deploymentName: string,
  parameters: Record<string, unknown>
) {
  const response = await fetch(
    `${PREFECT_API_URL}/deployments/name/${deploymentName}`,
    {
      headers: {
        'Authorization': `Bearer ${PREFECT_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  // ... rest of implementation
}
```

Set environment variables:
```bash
fly secrets set \
  PREFECT_API_URL="https://api-gateway.fly.dev/captionacc/prefect/api" \
  PREFECT_AUTH_TOKEN="<token-from-step-4-web>" \
  -a captionacc-web
```

### 6. Verify End-to-End

Test the complete flow:

```bash
# 1. Check gateway health
curl https://api-gateway.fly.dev/ping

# 2. Check Prefect health via gateway (with auth)
curl https://api-gateway.fly.dev/captionacc/prefect/api/health \
  -H "Authorization: Bearer <any-valid-token>"

# 3. Test from your services
# (Deploy a test flow, check logs, etc.)
```

## Rollback Plan

If something goes wrong:

### Quick Rollback (Revert Prefect to Public)

```bash
cd services/prefect-service

# Revert fly.toml to previous version
git checkout HEAD~1 fly.toml

# Redeploy
fly deploy -a prefect-service

# Services will work again without auth
```

### Full Rollback

1. Revert Prefect service configuration
2. Remove gateway deployment: `fly apps destroy api-gateway`
3. Revert client service changes
4. Redeploy all services

## Token Management

### View Active Tokens

```sql
-- In Supabase SQL editor
SELECT
  project,
  service,
  description,
  created_at,
  expires_at,
  last_used_at
FROM gateway_tokens
WHERE is_active = true
ORDER BY created_at DESC;
```

### Revoke a Token

```sql
SELECT revoke_gateway_token(
  'jwt-id-here',
  'admin-username',
  'Reason for revocation'
);
```

### Rotate Tokens

```bash
# Generate new token
python services/api-gateway/generate-token.py \
  --project captionacc \
  --service api \
  --description "Rotated API service token"

# Update service
fly secrets set PREFECT_AUTH_TOKEN="<new-token>" -a captionacc-api

# Revoke old token
# (Use SQL query above with old JTI)
```

## Monitoring

### Check Gateway Logs

```bash
fly logs -a api-gateway
```

### Check Metrics

```bash
# Prometheus metrics
curl https://api-gateway.fly.dev/metrics
```

### Check Token Usage

```sql
-- Tokens not used recently
SELECT
  project,
  service,
  description,
  last_used_at,
  NOW() - last_used_at as time_since_use
FROM gateway_tokens
WHERE is_active = true
  AND last_used_at < NOW() - INTERVAL '7 days'
ORDER BY last_used_at DESC;
```

## Troubleshooting

### "401 Unauthorized" from Gateway

- Verify token is valid: Check `gateway_tokens` table
- Check token expiration
- Verify `Authorization` header format: `Bearer <token>`

### "403 Forbidden" from Gateway

- Token signature invalid
- Verify `GATEWAY_JWT_SECRET` matches between Supabase and Traefik
- Check token claims match routing rules

### "Connection refused" to Prefect

- Prefect service may be down
- Check Fly.io 6PN networking: `fly status -a prefect-service`
- Verify internal DNS resolves: `prefect-service.internal`

### Gateway not routing correctly

- Check Traefik logs: `fly logs -a api-gateway`
- Verify dynamic config: `dynamic/captionacc.yml`
- Check path prefix matches: `/captionacc/prefect/api/*`

## Security Best Practices

1. **Rotate tokens regularly** (every 90 days recommended)
2. **Use unique tokens per service** (easier to revoke/audit)
3. **Monitor token usage** (detect compromised tokens)
4. **Use short expiration for high-risk services**
5. **Revoke tokens immediately when decommissioning services**
6. **Keep `GATEWAY_JWT_SECRET` secure** (never commit to git)
7. **Use separate tokens for dev/staging/prod environments**

## Next Steps

- Set up automated token rotation
- Configure alerts for expired tokens
- Add rate limiting to gateway
- Implement token usage analytics dashboard
