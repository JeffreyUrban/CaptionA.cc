# Wasabi Credential Rotation Guide

**Frequency:** Every 90 days

**Credentials:**
- `captionacc-app-readonly` (web app)
- `captionacc-orchestrator` (video processing)

---

## Prerequisites

- Access to Wasabi Console
- Fly.io CLI installed and authenticated
- Production app names known

---

## Rotation Process

### captionacc-app-readonly (Web App)

1. **Wasabi Console** → Users → captionacc-app-readonly → Generate New Access Key
2. **Update local `.env`:**
   ```bash
   WASABI_ACCESS_KEY_READONLY=<new_key>
   WASABI_SECRET_KEY_READONLY=<new_secret>
   ```
3. **Update Fly.io secrets:**
   ```bash
   fly secrets set \
     WASABI_ACCESS_KEY_READONLY=<new_key> \
     WASABI_SECRET_KEY_READONLY=<new_secret> \
     -a <web-app-name>
   ```
4. **Verify health:**
   ```bash
   # Check health endpoint
   curl https://<web-app-name>.fly.dev/health

   # Check Fly status
   fly status -a <web-app-name>
   ```
5. **Wait 48 hours** for old credentials to age out
6. **Delete old access key** in Wasabi Console

---

### captionacc-orchestrator (Processing)

1. **Wasabi Console** → Users → captionacc-orchestrator → Generate New Access Key
2. **Update local `.env`:**
   ```bash
   WASABI_ACCESS_KEY_READWRITE=<new_key>
   WASABI_SECRET_KEY_READWRITE=<new_secret>
   ```
3. **Update Fly.io secrets:**
   ```bash
   fly secrets set \
     WASABI_ACCESS_KEY_READWRITE=<new_key> \
     WASABI_SECRET_KEY_READWRITE=<new_secret> \
     -a <orchestrator-app-name>
   ```
4. **Verify health:**
   ```bash
   # Test local credentials
   ./scripts/wasabi-test-access.sh

   # Check production health
   fly status -a <orchestrator-app-name>

   # Trigger test processing job (if available)
   ```
5. **Wait 48 hours**
6. **Delete old access key** in Wasabi Console

---

## Verification

### Automated Health Checks

**Production apps have `/health` endpoints that test Wasabi connectivity:**

```bash
# Web app health check
curl https://<web-app-name>.fly.dev/health
# Expected: {"wasabi": true, "database": true}

# Check Fly.io health status
fly status -a <web-app-name>
# Expected: All instances "Healthy"
```

### Manual Testing

**Local development:**
```bash
# Test read-only credentials
source .env
./scripts/wasabi-test-access.sh
```

**Expected output:**
```
Test 1: Can list all buckets?
✅ NO - Credentials restricted (good!)

Test 2: Can access caption-acc-prod bucket?
✅ YES - Can access app bucket (expected)

Test 3: Can write to caption-acc-prod bucket?
[For readonly]: ⚠️  NO - Read-only access
[For readwrite]: ✅ YES - Has write access

Test 4: Can delete from caption-acc-prod bucket?
[For readonly]: ⚠️  Cannot test (no write access)
[For readwrite]: ✅ YES - Has delete access
```

---

## Rollback Procedure

**If new credentials don't work:**

1. **Keep old access key active** in Wasabi Console (don't delete)
2. **Revert Fly.io secrets:**
   ```bash
   fly secrets set \
     WASABI_ACCESS_KEY_READONLY=<old_key> \
     WASABI_SECRET_KEY_READONLY=<old_secret> \
     -a <web-app-name>
   ```
3. **Verify health checks pass**
4. **Investigate issue** with new credentials
5. **Try rotation again** after fixing

---

## Security Notes

### Grace Period

**Wait 48 hours before deleting old keys** to ensure:
- All services have restarted with new credentials
- No cached connections using old credentials
- Health checks are consistently passing

### Key Reuse

**Never reuse old access keys.** Always generate new keys during rotation.

### Monitoring

**Check Wasabi "Last Used" timestamp** in Console before deleting old keys:
- If recently used → delay deletion
- If not used in 48h → safe to delete

---

## Schedule

**Set calendar reminders for:**

| Credential | Next Rotation Date | Frequency |
|-----------|-------------------|-----------|
| captionacc-app-readonly | Every 90 days | Quarterly |
| captionacc-orchestrator | Every 90 days | Quarterly |

**Stagger rotations** by 1 week to avoid rotating both simultaneously.

---

## Troubleshooting

### Health checks fail after rotation

**Symptoms:** `/health` returns 503, "wasabi: false"

**Causes:**
1. Access key typo in Fly secrets
2. New key not activated in Wasabi
3. Policy not attached to user

**Fix:**
```bash
# Re-check Fly secrets (obscured)
fly secrets list -a <app-name>

# Verify in Wasabi Console:
# - Access key exists and is "Active"
# - Correct policy attached to user
```

### "Access Denied" errors

**Symptoms:** S3 operations fail with AccessDenied

**Causes:**
1. IAM policy not attached to user
2. Wrong credentials in environment
3. Policy has syntax error

**Fix:**
```bash
# Test credentials directly
export WASABI_ACCESS_KEY="<key>"
export WASABI_SECRET_KEY="<secret>"
aws s3 ls s3://caption-acc-prod/ --endpoint-url https://s3.us-east-1.wasabisys.com

# Should succeed. If not, check Wasabi Console IAM settings
```

---

## Automation Considerations

**Current approach:** Manual rotation (practical for 2 credentials)

**When to automate:**
- More than 10 credentials
- Compliance requires 30-day rotation
- Multiple team members managing credentials

**Automation options:**
- AWS Secrets Manager ($0.40/secret/month)
- Custom script with Wasabi API
- HashiCorp Vault (enterprise)

**For CaptionA.cc:** Manual rotation is sufficient given credential count and team size.
