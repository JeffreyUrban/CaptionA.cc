#!/bin/bash

# Find project root (worktree-aware)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load environment variables from worktree's .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
    echo "Loaded .env from: $PROJECT_ROOT/.env"
else
    echo "Warning: No .env found at $PROJECT_ROOT/.env"
fi

# Set Prefect API URL and enable debug logging (can be overridden by .env)
export PREFECT_API_URL="${PREFECT_API_URL:-https://prefect-service.fly.dev/api}"
export PREFECT_LOGGING_LEVEL="${PREFECT_LOGGING_LEVEL:-DEBUG}"

# Auto-detect deploy name from path if not set in .env
if [ -z "$PREFECT_DEPLOY_NAME" ]; then
    PREFECT_DEPLOY_NAME=$(echo "$PROJECT_ROOT" | grep -oE 'CaptionA\.cc-([a-zA-Z0-9]+)' | sed 's/CaptionA\.cc-//' || echo "production")
    export PREFECT_DEPLOY_NAME
fi

# Start the worker
echo ""
echo "Starting Prefect worker..."
echo "  Work pool: captionacc-workers"
echo "  Deploy name: $PREFECT_DEPLOY_NAME"
echo "  Prefect API: $PREFECT_API_URL"
echo "  Logging level: $PREFECT_LOGGING_LEVEL"
echo ""

prefect worker start --pool captionacc-workers
