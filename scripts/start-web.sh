#!/bin/bash
# Start the web development server
#
# Usage: ./scripts/start-web.sh
#
# Reads PORT_WEB from .env and starts Vite dev server on that port.
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

# Default to 6000 if PORT_WEB not set
PORT_WEB="${PORT_WEB:-6000}"
PORT_API="${PORT_API:-6001}"

echo ""
echo "Starting web server on port $PORT_WEB"
echo "API proxy target: http://localhost:$PORT_API"
echo ""

# Set API_URL for vite proxy configuration
export API_URL="http://localhost:$PORT_API"

# Change to project root and start vite
cd "$PROJECT_ROOT"
npm run dev --workspace=apps/captionacc-web -- --port "$PORT_WEB"
