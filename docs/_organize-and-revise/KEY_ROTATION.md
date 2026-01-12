# Credential Rotation Guide

This document describes the process for rotating API keys and credentials for CaptionA.cc infrastructure.

## Overview

The system uses multiple sets of credentials that should be rotated periodically:

- **Wasabi S3 Access Keys** (2 sets: readonly, readwrite)
- **Supabase Service Role Key** (shared across apps)
- **Prefect API Key** (orchestrator only)

**Rotation Schedule**:
- Wasabi keys: Every **45-90 days** (AWS recommendation)
- Supabase keys: **Annually** or when compromised
- Prefect keys: **Annually** or when compromised

## Wasabi Key Rotation

Wasabi allows up to **2 active access keys** per user, enabling zero-downtime rotation.

### Process Overview

1. Create new key (now you have 2 active)
2. Deploy new key to production
3. Verify health checks pass
4. Wait 48 hours monitoring for old key usage
5. Delete old key after confirming zero usage

### Step-by-Step: Readonly Keys (Web App)

**1. Create New Key in Wasabi Console**
```
1. Log into Wasabi Console: https://console.wasabisys.com/
2. Go to Access Keys
3. Click "Create Access Key"
4. Name: "captionacc-readonly-2026-01" (include date)
5. Save access key ID and secret key immediately
```

**2. Update Production Secrets**
```bash
# Set new readonly credentials
fly secrets set \
  WASABI_ACCESS_KEY_READONLY="new_access_key_id" \
  WASABI_SECRET_KEY_READONLY="new_secret_key" \
  -a captionacc-web

# This triggers automatic restart
```

**3. Verify Health (Wait 60s for restart)**
```bash
# Check machine status
fly status -a captionacc-web

# Check health endpoint
curl https://captionacc-web.fly.dev/health | jq '.'

# Should return 200 OK with:
# {
#   "status": "healthy",
#   "components": {
#     "wasabi": {
#       "status": "healthy",
#       ...
#     }
#   }
# }
```

**4. Update Local Development**
```bash
# Update .env file
cd apps/captionacc-web
nano .env  # or your editor

# Update these lines:
WASABI_ACCESS_KEY_READONLY=new_access_key_id
WASABI_SECRET_KEY_READONLY=new_secret_key

# Test locally
npm run dev
# Visit localhost:3000 and test video playback
```

**5. Monitor Old Key Usage (48 hours)**
```
1. Go to Wasabi Console → Access Keys
2. Check "Last Used" timestamp for OLD key
3. Wait 48 hours
4. Confirm old key shows no recent usage
```

**6. Delete Old Key**
```
1. Wasabi Console → Access Keys
2. Find old key (earlier date in name)
3. Click Delete
4. Confirm deletion
```

### Step-by-Step: Readwrite Keys (Orchestrator)

**1. Create New Key in Wasabi Console**
```
1. Same as readonly process above
2. Name: "captionacc-readwrite-2026-01"
```

**2. Update Production Secrets**
```bash
# Set new readwrite credentials
fly secrets set \
  WASABI_ACCESS_KEY_READWRITE="new_access_key_id" \
  WASABI_SECRET_KEY_READWRITE="new_secret_key" \
  -a captionacc-orchestrator

# Triggers restart (takes 90s due to Prefect connection)
```

**3. Verify Health (Wait 120s for restart + Prefect init)**
```bash
# Check machine status
fly status -a captionacc-orchestrator

# Check health endpoint
curl https://captionacc-orchestrator.fly.dev/health | jq '.'

# Should return 200 OK with:
# {
#   "status": "healthy",
#   "components": {
#     "wasabi": {
#       "status": "healthy",
#       "permissions": "readwrite",
#       ...
#     }
#   }
# }
```

**4. Update Local Development**
```bash
cd services/orchestrator
nano .env

# Update:
WASABI_ACCESS_KEY_READWRITE=new_access_key_id
WASABI_SECRET_KEY_READWRITE=new_secret_key

# Test locally
python start_all.py
```

**5-6. Monitor and Delete Old Key**
Same as readonly process above.

## Rollback Procedure

If health checks fail after rotation:

**1. Immediate Rollback**
```bash
# Restore old credentials
fly secrets set \
  WASABI_ACCESS_KEY_READONLY="old_access_key_id" \
  WASABI_SECRET_KEY_READONLY="old_secret_key" \
  -a captionacc-web

# Wait for restart
sleep 60

# Verify health
curl https://captionacc-web.fly.dev/health | jq '.components.wasabi'
```

**2. Investigate Issue**
```bash
# Check logs for errors
fly logs -a captionacc-web --since 10m | grep -i wasabi

# Common issues:
# - "InvalidAccessKeyId" → Wrong access key
# - "SignatureDoesNotMatch" → Wrong secret key
# - "AccessDenied" → Permissions not configured
```

**3. Retry with Correct Credentials**
Once issue identified, repeat rotation with fixes.

## Supabase Key Rotation

Supabase provides service role keys that should be rotated annually or if compromised.

### Process

**1. Generate New Service Role Key**
```
1. Supabase Dashboard → Settings → API
2. Click "Generate new service_role key"
3. Copy new key immediately
```

**2. Update All Apps**
```bash
# Web app
fly secrets set \
  VITE_SUPABASE_SERVICE_ROLE_KEY="new_key" \
  -a captionacc-web

# Orchestrator
fly secrets set \
  SUPABASE_SERVICE_ROLE_KEY="new_key" \
  -a captionacc-orchestrator
```

**3. Verify Health**
```bash
# Check both apps
curl https://captionacc-web.fly.dev/health | jq '.components.supabase'
curl https://captionacc-orchestrator.fly.dev/health | jq '.components.supabase'
```

**4. Update Local Development**
```bash
# Web app
cd apps/captionacc-web
nano .env
# Update VITE_SUPABASE_SERVICE_ROLE_KEY

# Orchestrator
cd services/orchestrator
nano .env
# Update SUPABASE_SERVICE_ROLE_KEY
```

**5. Revoke Old Key**
```
1. Supabase Dashboard → Settings → API
2. Find old service_role key
3. Click "Revoke"
```

## Prefect API Key Rotation

Used by orchestrator to connect to Prefect Cloud.

### Process

**1. Generate New API Key**
```
1. Prefect Cloud → User Settings → API Keys
2. Click "Create API Key"
3. Name: "orchestrator-2026-01"
4. Copy key immediately
```

**2. Update Orchestrator**
```bash
fly secrets set \
  PREFECT_API_KEY="new_key" \
  -a captionacc-orchestrator
```

**3. Verify Health**
```bash
# Check Prefect component
curl https://captionacc-orchestrator.fly.dev/health | jq '.components.prefect'
```

**4. Update Local Development**
```bash
cd services/orchestrator
nano .env
# Update PREFECT_API_KEY

# Test
python start_worker.py
# Should connect successfully
```

**5. Delete Old Key**
```
1. Prefect Cloud → User Settings → API Keys
2. Find old key
3. Click Delete
```

## Health Check Integration

The health check system verifies credential validity:

### Immediate Verification
After rotating any credentials, health endpoints will immediately detect issues:

```bash
# Quick verification
curl https://captionacc-web.fly.dev/health

# Returns 503 if credentials invalid
# Returns 200 if healthy
```

### Automated Monitoring
GitHub Actions workflow runs daily and will alert on failures:

- Checks health of both apps
- Emails on failures (via GitHub notifications)
- Detects restart loops caused by bad credentials

### Manual Monitoring
```bash
# Check Fly.io status
fly status -a captionacc-web

# If health checks failing:
# - "Health Checks: 0 passing, 1 critical"
# - Indicates credential or service issue
```

## Security Best Practices

### Key Management
- ✅ Never commit credentials to git
- ✅ Use Fly.io secrets for production
- ✅ Use `.env` files (in `.gitignore`) for local dev
- ✅ Rotate keys every 45-90 days minimum
- ✅ Delete old keys after confirming new ones work

### Rotation Timing
- ✅ Rotate during low-traffic periods
- ✅ Have rollback plan ready
- ✅ Monitor for 48h after rotation
- ✅ Update documentation with rotation dates

### Access Control
- ✅ Limit number of people with key access
- ✅ Use separate keys for readonly vs readwrite
- ✅ Audit key usage regularly (check "Last Used")
- ✅ Rotate immediately if key compromised

## Common Issues

### "InvalidAccessKeyId" Error

**Cause**: Wrong access key ID

**Fix**:
```bash
# Double-check key ID (should be 20 chars, alphanumeric)
fly secrets list -a captionacc-web | grep WASABI_ACCESS_KEY

# If wrong, set correct value
fly secrets set WASABI_ACCESS_KEY_READONLY="correct_key_id" -a captionacc-web
```

### "SignatureDoesNotMatch" Error

**Cause**: Wrong secret key

**Fix**:
```bash
# Secret key should be 40 chars
# Common issue: trailing newline or space

# Unset and reset (clears any whitespace issues)
fly secrets unset WASABI_SECRET_KEY_READONLY -a captionacc-web
fly secrets set WASABI_SECRET_KEY_READONLY="correct_secret" -a captionacc-web
```

### Health Check Passes But Videos Don't Load

**Cause**: Health check uses different key than video playback

**Debug**:
```bash
# Check which keys are set
fly secrets list -a captionacc-web

# Should have both:
# - WASABI_ACCESS_KEY_READONLY
# - WASABI_SECRET_KEY_READONLY

# Not:
# - WASABI_ACCESS_KEY (old/generic)
# - WASABI_SECRET_KEY (old/generic)
```

## Credential Inventory

Current credentials required:

### Web App (`captionacc-web`)
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_SCHEMA
WASABI_ACCESS_KEY_READONLY
WASABI_SECRET_KEY_READONLY
WASABI_BUCKET
WASABI_REGION
```

### Orchestrator (`captionacc-orchestrator`)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SCHEMA
WASABI_ACCESS_KEY_READWRITE
WASABI_SECRET_KEY_READWRITE
WASABI_BUCKET
WASABI_REGION
PREFECT_API_URL
PREFECT_API_KEY
```

### Local Development
Both apps need `.env` files with same variables as production.

## Rotation Checklist

Use this checklist when rotating credentials:

### Before Rotation
- [ ] Identify which credentials to rotate
- [ ] Plan rotation during low-traffic period
- [ ] Ensure you have rollback access
- [ ] Notify team members (if applicable)

### During Rotation
- [ ] Create new credentials in provider console
- [ ] Update Fly.io secrets
- [ ] Wait for machine restart
- [ ] Verify health endpoint returns 200 OK
- [ ] Check logs for errors
- [ ] Update local `.env` files
- [ ] Test locally

### After Rotation
- [ ] Monitor for 48 hours
- [ ] Check "Last Used" for old credentials
- [ ] Confirm old credentials show no recent activity
- [ ] Delete old credentials
- [ ] Document rotation date
- [ ] Set calendar reminder for next rotation

## Related Documentation

- [Health Checks & Monitoring](HEALTH_CHECKS.md)
- [Wasabi Storage Architecture](data-architecture/archive-revise-or-remove/WASABI_ARCHITECTURE.md)
- [Fly.io Deployment](../../README.md#deployment)
