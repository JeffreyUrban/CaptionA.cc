#!/usr/bin/env bash
#
# Trigger process new videos check via internal API endpoint.
#
# This script is called by Supercronic on a schedule to check for new videos.
# It runs inside the API container and makes a local HTTP request to trigger
# the process new videos flow.
#
# Usage (from crontab):
#   */15 * * * * bash /app/scripts/trigger_process_new_videos.sh
#
# Environment variables:
#   API_INTERNAL_URL - API URL (default: http://localhost:8000 for same-container calls)
#

set -euo pipefail

API_INTERNAL_URL="${API_INTERNAL_URL:-http://localhost:8000}"
ENDPOINT="${API_INTERNAL_URL}/internal/process-new-videos/trigger"

echo "=== Process New Videos Trigger ==="
echo "Endpoint: ${ENDPOINT}"
echo "Time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# Trigger endpoint with timeout
# Use -f to fail on HTTP errors, -s for silent mode, -S to show errors
if response=$(curl -f -s -S -X POST "${ENDPOINT}" \
    -H "Content-Type: application/json" \
    --connect-timeout 10 \
    --max-time 30); then

    echo "✓ Process new videos flow triggered successfully"
    echo ""
    echo "Response:"
    echo "${response}" | jq '.' || echo "${response}"

    exit 0
else
    exit_code=$?
    echo "✗ Failed to trigger process new videos flow (exit code: ${exit_code})"
    exit "${exit_code}"
fi
