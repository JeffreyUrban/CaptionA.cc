# Wasabi Bucket Configuration

## Current Setup

### Application Bucket
**Name:** `captionacc-prod`
**Region:** `us-east-1`

**Features Enabled:**
- ✅ Versioning
- ✅ Access logging
- ✅ Public access block
- ✅ Server-side encryption (Wasabi default)

### Audit Logs Bucket
**Name:** `captionacc-audit-logs`
**Region:** `us-east-1`

**Purpose:** Stores access logs for captionacc-prod bucket

**Lifecycle:** Logs auto-delete after 90 days

---

## Applying Configuration

### Initial Setup

**Prerequisites:**
1. Create `captionacc-audit-logs` bucket manually in Wasabi Console
2. AWS CLI configured with appropriate credentials

**Run setup script:**
```bash
./scripts/wasabi-setup-bucket.sh
```

### What the Script Does

1. **Enables access logging** on `captionacc-prod`
   - Logs written to: `s3://captionacc-audit-logs/captionacc-prod/`
   - Captures: All GET, PUT, DELETE operations

2. **Configures lifecycle policy** on `captionacc-audit-logs`
   - Auto-deletes logs after 90 days
   - Prevents unbounded storage growth

3. **Verifies configuration**
   - Checks logging status
   - Displays lifecycle policy

### Manual Configuration

**If you need to configure manually:**

#### Enable Access Logging
```bash
aws s3api put-bucket-logging \
  --bucket captionacc-prod \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "captionacc-audit-logs",
      "TargetPrefix": "captionacc-prod/"
    }
  }' \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

#### Configure Log Retention
```bash
cat > /tmp/lifecycle.json << 'EOF'
{
  "Rules": [
    {
      "ID": "DeleteOldLogs",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Expiration": {
        "Days": 90
      }
    }
  ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
  --bucket captionacc-audit-logs \
  --lifecycle-configuration file:///tmp/lifecycle.json \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

---

## Verification

### Check Logging Status
```bash
aws s3api get-bucket-logging \
  --bucket captionacc-prod \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

**Expected output:**
```json
{
  "LoggingEnabled": {
    "TargetBucket": "captionacc-audit-logs",
    "TargetPrefix": "captionacc-prod/"
  }
}
```

### Check Lifecycle Policy
```bash
aws s3api get-bucket-lifecycle-configuration \
  --bucket captionacc-audit-logs \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

**Expected output:**
```json
{
  "Rules": [
    {
      "ID": "DeleteOldLogs",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Expiration": {
        "Days": 90
      }
    }
  ]
}
```

### View Access Logs
```bash
# List recent logs
aws s3 ls s3://captionacc-audit-logs/captionacc-prod/ \
  --endpoint-url https://s3.us-east-1.wasabisys.com

# Download specific log
aws s3 cp s3://captionacc-audit-logs/captionacc-prod/2026-01-06-12-00-00-ABCD1234 . \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

**Log format:** Standard S3 access log format
- Each line = one request
- Fields: time, remote IP, operation, key, HTTP status, bytes sent, etc.

---

## Configuration Changes

### Adjust Log Retention Period

**To change from 90 to 365 days:**

1. Edit `scripts/setup-wasabi-bucket.sh`:
   ```bash
   LOG_RETENTION_DAYS=365
   ```

2. Re-run script:
   ```bash
   ./scripts/wasabi-setup-bucket.sh
   ```

### Disable Access Logging

```bash
aws s3api put-bucket-logging \
  --bucket captionacc-prod \
  --bucket-logging-status '{}' \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

### Enable Versioning (if not already enabled)

```bash
aws s3api put-bucket-versioning \
  --bucket captionacc-prod \
  --versioning-configuration Status=Enabled \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

---

## Design Decisions

### Why 90-day log retention?

**Balance between:**
- Audit capability (3 months of history)
- Storage costs (logs can grow large)
- Security investigation window (most incidents detected within 30-60 days)

**Can be increased to 365 days if:**
- Compliance requirements
- Security posture requires longer retention
- Storage costs are not a concern

### Why separate audit bucket?

**Benefits:**
- Logs don't mix with application data
- Can apply different lifecycle policies
- Can restrict access differently (logs are sensitive)
- Clean separation of concerns

### Why not use CloudTrail/Wasabi equivalent?

**Reasoning:**
- S3 access logs sufficient for object-level tracking
- No Wasabi-native CloudTrail equivalent
- Access logs are free (just pay for storage)
- Simpler setup and maintenance

---

## Troubleshooting

### Logs not appearing

**Causes:**
1. Log delivery delay (can take 2-24 hours for first logs)
2. No activity on bucket (logs only created when requests occur)
3. Logging configuration incorrect

**Check:**
```bash
# Verify logging is enabled
aws s3api get-bucket-logging --bucket captionacc-prod --endpoint-url https://s3.us-east-1.wasabisys.com

# Trigger some activity
aws s3 ls s3://captionacc-prod/ --endpoint-url https://s3.us-east-1.wasabisys.com

# Wait 30 minutes, then check for logs
aws s3 ls s3://captionacc-audit-logs/captionacc-prod/ --endpoint-url https://s3.us-east-1.wasabisys.com
```

### Lifecycle policy not deleting old logs

**Causes:**
1. Policy not applied correctly
2. Logs not old enough yet (90 days)
3. Wasabi lifecycle processing delay (runs daily)

**Check:**
```bash
# Verify policy
aws s3api get-bucket-lifecycle-configuration --bucket captionacc-audit-logs --endpoint-url https://s3.us-east-1.wasabisys.com

# Check log ages
aws s3 ls s3://captionacc-audit-logs/captionacc-prod/ --recursive --endpoint-url https://s3.us-east-1.wasabisys.com
```

---

## References

- **Setup Script:** `/scripts/setup-wasabi-bucket.sh`
- **Wasabi Logging Docs:** https://docs.wasabi.com/docs/logging-s3-requests
- **Wasabi Lifecycle Docs:** https://docs.wasabi.com/docs/lifecycle-policies
