#!/bin/bash
# Wasabi Bucket Configuration Setup
#
# This script configures access logging and lifecycle policies for captionacc-prod bucket.
# Safe to run multiple times (idempotent).
#
# Prerequisites:
# - AWS CLI configured with Wasabi credentials
# - captionacc-audit-logs bucket already exists

set -e

ENDPOINT="https://s3.us-east-1.wasabisys.com"
APP_BUCKET="captionacc-prod"
AUDIT_BUCKET="captionacc-audit-logs"
LOG_RETENTION_DAYS=90

echo "=========================================="
echo "Wasabi Bucket Configuration"
echo "=========================================="
echo ""

# 1. Enable Access Logging
echo "📋 Enabling access logging for: $APP_BUCKET"
echo "   Logs will be written to: s3://$AUDIT_BUCKET/$APP_BUCKET/"

aws s3api put-bucket-logging \
  --bucket "$APP_BUCKET" \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "'"$AUDIT_BUCKET"'",
      "TargetPrefix": "'"$APP_BUCKET"'/"
    }
  }' \
  --endpoint-url "$ENDPOINT"

echo "✅ Access logging enabled"
echo ""

# 2. Configure Log Retention
echo "🗑️  Setting up lifecycle policy on audit bucket"
echo "   Old logs will be deleted after: $LOG_RETENTION_DAYS days"

cat > /tmp/lifecycle-audit-logs.json << EOF
{
  "Rules": [
    {
      "ID": "DeleteOldLogs",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Expiration": {
        "Days": $LOG_RETENTION_DAYS
      }
    }
  ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
  --bucket "$AUDIT_BUCKET" \
  --lifecycle-configuration file:///tmp/lifecycle-audit-logs.json \
  --endpoint-url "$ENDPOINT"

rm /tmp/lifecycle-audit-logs.json

echo "✅ Lifecycle policy configured"
echo ""

# 3. Verify Configuration
echo "🔍 Verifying configuration..."
echo ""

echo "Access Logging Status:"
aws s3api get-bucket-logging \
  --bucket "$APP_BUCKET" \
  --endpoint-url "$ENDPOINT"

echo ""
echo "Lifecycle Policy:"
aws s3api get-bucket-lifecycle-configuration \
  --bucket "$AUDIT_BUCKET" \
  --endpoint-url "$ENDPOINT"

echo ""
echo "=========================================="
echo "✅ Configuration Complete"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Access logs will appear in: s3://$AUDIT_BUCKET/$APP_BUCKET/"
echo "2. Logs older than $LOG_RETENTION_DAYS days will be auto-deleted"
echo "3. Monitor log delivery (may take a few hours for first logs)"
