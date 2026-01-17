#!/usr/bin/env bash
# Deploy Prefect flows as deployments
# This script is idempotent and can be run multiple times safely
# It's designed to be run as a Fly.io release command

set -euo pipefail

echo "=== Prefect Deployment Registration ==="
echo "PREFECT_API_URL: ${PREFECT_API_URL:-not set}"
echo "Current directory: $(pwd)"

# Check if PREFECT_API_URL is set
if [ -z "${PREFECT_API_URL:-}" ]; then
    echo "ERROR: PREFECT_API_URL environment variable is not set"
    exit 1
fi

# Check if prefect.yaml exists
if [ ! -f "prefect.yaml" ]; then
    echo "ERROR: prefect.yaml not found in current directory"
    exit 1
fi

echo ""
echo "Deploying flows from prefect.yaml..."
echo ""

# Deploy all flows defined in prefect.yaml
# This is idempotent - it will create or update deployments
prefect deploy --all

echo ""
echo "=== Deployment Registration Complete ==="
echo ""
