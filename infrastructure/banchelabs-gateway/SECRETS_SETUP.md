# Secrets Setup Guide for Traefik-Prefect

This guide covers all the secrets you need to configure for the banchelabs-gateway deployment.

## Overview

The banchelabs-gateway service requires secrets in three places:
1. **Supabase** - For the Edge Function to generate JWT tokens
2. **GitHub** - For automated deployments via GitHub Actions
3. **Fly.io** - For the running banchelabs-gateway application

## Step 1: Generate GATEWAY_JWT_SECRET

Generate a secure random secret for JWT signing:

```bash
openssl rand -base64 32
```

**⚠️ IMPORTANT:** Save this secret securely! You'll need to set it in multiple places and it must be the SAME value everywhere.

## Step 2: Set Secret in Supabase

The Edge Function `generate-gateway-token` uses this secret to sign JWT tokens.

```bash
# Set the secret in Supabase
supabase secrets set GATEWAY_JWT_SECRET="<your-secret-from-step-1>"

# Verify it was set
supabase secrets list
```

**Note:** After setting secrets, you need to redeploy the Edge Function:

```bash
# Redeploy the Edge Function to pick up the new secret
supabase functions deploy generate-gateway-token
```

## Step 3: Set Secrets in GitHub

These secrets are used by GitHub Actions for automated deployments.

Go to your repository: **Settings → Secrets and variables → Actions → New repository secret**

### Required Secrets:

1. **`GATEWAY_JWT_SECRET`**
   - Value: The same secret from Step 1
   - Used by: Both production and preview deployments

2. **`SUPABASE_DIRECT_CONNECTION_STRING`**
   - Value: Your Supabase database direct connection string (production)
   - Format: `postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-ID].supabase.co:5432/postgres`
   - Get from: Supabase Dashboard → Settings → Database → **"Direct connection"** (not pooler)
   - Note: This is your main Supabase PostgreSQL database. Prefect will create a `prefect` schema within it alongside your other schemas.

3. **`SUPABASE_DIRECT_CONNECTION_STRING_STAGING`** (optional)
   - Value: Your staging database connection string (or same as production)
   - Used by: Preview/review deployments only
   - If not using a separate staging database, you can use the same value as production

4. **`FLY_API_TOKEN`** (if not already set)
   - Value: Your Fly.io API token
   - Get from: `fly auth token` or Fly.io dashboard

## Step 4: Set Secrets in Fly.io (Production)

For the main production deployment:

```bash
cd infrastructure/banchelabs-gateway

# Create the app first (if not already created)
fly apps create banchelabs-gateway --org personal

# Set secrets
# Note: PREFECT_API_DATABASE_CONNECTION_URL is the env var that Prefect reads
fly secrets set \
  GATEWAY_JWT_SECRET='<your-secret-from-step-1>' \
  PREFECT_API_DATABASE_CONNECTION_URL='<your-supabase-direct-connection-string>' \
  -a banchelabs-gateway
```

**Notes:**
- Preview apps get their secrets automatically from GitHub Actions
- GitHub Actions maps `SUPABASE_DIRECT_CONNECTION_STRING` → `PREFECT_API_DATABASE_CONNECTION_URL` in Fly.io
- The Fly.io environment variable name must be `PREFECT_API_DATABASE_CONNECTION_URL` (what Prefect expects)

## Verification Checklist

After setting all secrets, verify:

- [ ] Supabase secret is set: `supabase secrets list` shows `GATEWAY_JWT_SECRET`
- [ ] Edge Function is redeployed: `supabase functions deploy generate-gateway-token`
- [ ] GitHub secrets are set (4 total):
  - [ ] `GATEWAY_JWT_SECRET`
  - [ ] `SUPABASE_DIRECT_CONNECTION_STRING`
  - [ ] `SUPABASE_DIRECT_CONNECTION_STRING_STAGING`
  - [ ] `FLY_API_TOKEN`
- [ ] Fly.io production secrets are set: `fly secrets list -a banchelabs-gateway`
  - Should show: `GATEWAY_JWT_SECRET` and `PREFECT_API_DATABASE_CONNECTION_URL`

## Testing the Setup

Once all secrets are configured, test token generation:

```bash
# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Generate a test token using the script
cd infrastructure/banchelabs-gateway
python scripts/generate-token.py \
  --project captionacc \
  --service test \
  --description "Test token" \
  --expires-in-days 1
```

If successful, you'll get a JWT token. Save it for testing the gateway after deployment.

## Common Issues

### Edge Function can't generate tokens

**Error:** "Server configuration error" or "GATEWAY_JWT_SECRET environment variable not set"

**Fix:**
1. Verify secret is set: `supabase secrets list`
2. Redeploy the function: `supabase functions deploy generate-gateway-token`
3. Check function logs for errors

### GitHub Actions deployment fails

**Error:** Secrets not found during deployment

**Fix:**
1. Verify all 4 secrets are set in GitHub repository settings
2. Check secret names match exactly (case-sensitive)
3. Re-run the workflow

### Fly.io app can't start

**Error:** "Missing required environment variable"

**Fix:**
1. Check secrets are set: `fly secrets list -a banchelabs-gateway`
2. Set missing secrets using `fly secrets set`
3. Restart the app: `fly apps restart banchelabs-gateway`

## Security Best Practices

1. **Never commit secrets to git** - All secrets should be in environment variables only
2. **Use different secrets for staging/production** - Consider separate `GATEWAY_JWT_SECRET` values
3. **Rotate secrets regularly** - Change `GATEWAY_JWT_SECRET` every 90 days
4. **Limit token expiration** - Default is 90 days, max is 365 days
5. **Revoke old tokens** - Use the revocation API when rotating secrets

## Secret Rotation Process

### Rotating GATEWAY_JWT_SECRET

1. Generate new secret: `openssl rand -base64 32`  # pragma: allowlist secret
2. Update Supabase: `supabase secrets set GATEWAY_JWT_SECRET="<new-secret>"`  # pragma: allowlist secret
3. Redeploy Edge Function: `supabase functions deploy generate-gateway-token`
4. Update GitHub secrets in repository settings
5. Update Fly.io: `fly secrets set GATEWAY_JWT_SECRET="<new-secret>" -a banchelabs-gateway`
6. Generate new tokens for all services (old tokens will stop working)
7. Update all services with new tokens

### Rotating Database Password

If you rotate your Supabase database password:

1. Update in Supabase Dashboard
2. Update GitHub secrets: `SUPABASE_DIRECT_CONNECTION_STRING` (and `_STAGING` if separate)  # pragma: allowlist secret
3. Update Fly.io: `fly secrets set PREFECT_API_DATABASE_CONNECTION_URL="<new-connection-string>" -a banchelabs-gateway`  # pragma: allowlist secret
4. Restart the app: `fly apps restart banchelabs-gateway`

## Next Steps

After setting up secrets:
1. Deploy banchelabs-gateway to production (see DEPLOYMENT.md)
2. Generate service tokens for your applications
3. Configure client services to use the gateway

## Reference

- Deployment guide: `DEPLOYMENT.md`
- Architecture overview: `README.md`
- Token generation script: `scripts/generate-token.py`
