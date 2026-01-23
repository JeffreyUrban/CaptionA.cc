#!/bin/bash
# Start the API development server
#
# Usage: ./scripts/start-api.sh
#
# Reads PORT_API from .env and starts uvicorn on that port.
# Validates environment before starting.

set -e

# Source validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/validate-env.sh"

# Validate environment (will exit if prod detected)
validate_env

# Source .env to get port and other settings
set -a
source "$ENV_FILE"
set +a

# Default to 6001 if PORT_API not set
PORT_API="${PORT_API:-6001}"

echo ""
echo "Starting API server on port $PORT_API"
echo "Environment: $(detect_env_type)"
echo ""

# Change to API directory and start uvicorn
cd "$PROJECT_ROOT/services/api"

# Set the API_PORT env var for pydantic-settings
export API_PORT="$PORT_API"

# Start uvicorn with hot reload
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT_API"
