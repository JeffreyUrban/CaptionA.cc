#!/bin/bash
# Deploy Prefect flows for local development
#
# Usage: ./scripts/deploy-prefect-local.sh
#
# Deploys all flows defined in prefect-local.yaml to the local Prefect server.
# Requires Prefect server to be running (start with ./scripts/start-prefect.sh)

set -e

# Source validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/validate-env.sh"

# Validate environment (will exit if prod detected)
validate_env

# Source .env to get Prefect URL
set -a
source "$ENV_FILE"
set +a

PORT_PREFECT="${PORT_PREFECT:-6020}"
export PREFECT_API_URL="http://localhost:$PORT_PREFECT/api"

echo ""
echo -e "${BLUE}Deploying Prefect flows to local server...${NC}"
echo "  Prefect API: $PREFECT_API_URL"
echo ""

# Check if Prefect server is running
if ! curl -s "$PREFECT_API_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Prefect server is not running${NC}"
    echo "Start it with: ./scripts/start-prefect.sh"
    exit 1
fi

# Create local work pool if it doesn't exist
echo -e "${BLUE}Ensuring 'local' work pool exists...${NC}"
cd "$PROJECT_ROOT/services/api"
uv run prefect work-pool create local --type process 2>/dev/null || true
echo ""

# Deploy all flows
echo -e "${BLUE}Deploying flows...${NC}"
yes n | uv run prefect deploy --all --prefect-file prefect-local.yaml

echo ""
echo -e "${GREEN}✓ Flows deployed successfully${NC}"
echo ""
echo "Start a worker to run flows:"
echo "  ./scripts/start-prefect-worker.sh"
echo ""
