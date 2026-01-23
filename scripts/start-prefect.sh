#!/bin/bash
# Start local Prefect server for development
#
# Usage: ./scripts/start-prefect.sh
#
# Uses PORT_PREFECT from .env (configured per worktree).
# Validates environment before starting.

set -e

# Source validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/validate-env.sh"

# Validate environment (will exit if prod detected)
validate_env

# Source .env to get port
set -a
source "$ENV_FILE"
set +a

# Default to 6020 if PORT_PREFECT not set
PORT_PREFECT="${PORT_PREFECT:-6020}"

echo ""
echo -e "${BLUE}Starting Prefect server on port $PORT_PREFECT${NC}"
echo ""

# Change to API directory where prefect is installed via uv
cd "$PROJECT_ROOT/services/api"

# Set Prefect to use local server
export PREFECT_API_URL="http://localhost:$PORT_PREFECT/api"

# Start Prefect server
uv run prefect server start --port "$PORT_PREFECT"
