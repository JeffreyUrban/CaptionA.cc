#!/usr/bin/env bash
#
# Trigger video recovery check via internal API endpoint.
#
# This script is called by Supercronic on a schedule to check for stuck videos.
# It runs inside the API container and makes a local HTTP request to trigger
# the recovery flow.
#
# Usage (from crontab):
#   */15 * * * * bash /app/scripts/trigger_recovery.sh
#
# Environment variables:
#   API_INTERNAL_URL - API URL (default: http://localhost:8000 for same-container calls)
#

set -euo pipefail

API_INTERNAL_URL="${API_INTERNAL_URL:-http://localhost:8000}"
ENDPOINT="${API_INTERNAL_URL}/internal/recovery/trigger"

echo "=== Video Recovery Trigger ==="
echo "Endpoint: ${ENDPOINT}"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# Trigger recovery endpoint with timeout
# Use -f to fail on HTTP errors, -s for silent mode, -S to show errors
if response=$(curl -f -s -S -X POST "${ENDPOINT}" \
    -H "Content-Type: application/json" \
    --connect-timeout 10 \
    --max-time 30); then

    echo "✓ Recovery flow triggered successfully"
    echo ""
    echo "Response:"
    echo "${response}" | jq '.' || echo "${response}"

    exit 0
else
    exit_code=$?
    echo "✗ Failed to trigger recovery flow (exit code: ${exit_code})"
    exit "${exit_code}"
fi
