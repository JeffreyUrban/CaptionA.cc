#!/bin/bash
# Start a Prefect worker for local development
#
# Usage: ./scripts/start-prefect-worker.sh
#
# Starts a worker that polls the 'local' work pool for flow runs.
# Automatically deploys flows on first run if not already deployed.
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
echo -e "${BLUE}Starting Prefect worker for 'local' work pool...${NC}"
echo "  Prefect API: $PREFECT_API_URL"
echo ""

# Check if Prefect server is running
if ! curl -s "$PREFECT_API_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Prefect server is not running${NC}"
    echo "Start it with: ./scripts/start-prefect.sh"
    exit 1
fi

# Change to API directory where flows are located
cd "$PROJECT_ROOT/services/api"

# Create local work pool if it doesn't exist
echo -e "${BLUE}Ensuring 'local' work pool exists...${NC}"
uv run prefect work-pool create local --type process 2>/dev/null || true

# Check if flows are deployed, deploy if not
DEPLOYMENT_COUNT=$(curl -s -X POST "$PREFECT_API_URL/deployments/filter" \
    -H "Content-Type: application/json" \
    -d '{"deployments":{"name":{"like_":"local-%"}}}' | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [[ "$DEPLOYMENT_COUNT" -eq 0 ]]; then
    echo -e "${BLUE}No local deployments found. Deploying flows...${NC}"
    yes n | uv run prefect deploy --all --prefect-file prefect-local.yaml
    echo ""
fi

echo -e "${BLUE}Starting worker...${NC}"
echo ""

# Start the worker
uv run prefect worker start --pool local
