#!/bin/bash
#
# Deploy Prefect flows with auto-detected worktree name
#
# Priority order for deployment name:
#   1. Command-line argument (./deploy.sh myname)
#   2. PREFECT_DEPLOY_NAME from .env
#   3. Auto-detect from directory path (e.g., CaptionA.cc-claude1 → "claude1")
#   4. Default to "production"
#
# Usage:
#   ./deploy.sh          # Uses .env or auto-detects from directory
#   ./deploy.sh prod     # Uses "production" as deployment name
#   ./deploy.sh myname   # Uses "myname" as deployment name
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"

# Load .env if it exists (for PREFECT_DEPLOY_NAME and other settings)
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Get deployment name (priority: arg > .env > auto-detect > default)
if [ -n "$1" ]; then
    # Use provided argument
    if [ "$1" = "prod" ]; then
        DEPLOY_NAME="production"
    else
        DEPLOY_NAME="$1"
    fi
    echo "Using command-line argument: $DEPLOY_NAME"
elif [ -n "$PREFECT_DEPLOY_NAME" ]; then
    # Use .env setting
    DEPLOY_NAME="$PREFECT_DEPLOY_NAME"
    echo "Using PREFECT_DEPLOY_NAME from .env: $DEPLOY_NAME"
else
    # Auto-detect from directory path (e.g., /path/to/CaptionA.cc-claude1/...)
    DEPLOY_NAME=$(pwd | grep -oE 'CaptionA\.cc-([a-zA-Z0-9]+)' | sed 's/CaptionA\.cc-//' || echo "")

    if [ -z "$DEPLOY_NAME" ]; then
        DEPLOY_NAME="production"
        echo "Could not auto-detect worktree name, using 'production'"
    else
        echo "Auto-detected worktree name: $DEPLOY_NAME"
    fi
fi

echo "Deploying with name: $DEPLOY_NAME"
echo "Working directory: $SCRIPT_DIR"
echo ""

# Create temporary prefect.yaml with substituted values
TEMP_YAML=$(mktemp)
trap "rm -f $TEMP_YAML" EXIT

sed -e "s|__DEPLOY_NAME__|$DEPLOY_NAME|g" \
    -e "s|__WORKING_DIR__|$SCRIPT_DIR|g" \
    prefect.yaml > "$TEMP_YAML"

# Deploy using the temporary config
prefect deploy --all --prefect-file "$TEMP_YAML"

echo ""
echo "Deployment complete! Flows deployed with name suffix: $DEPLOY_NAME"
