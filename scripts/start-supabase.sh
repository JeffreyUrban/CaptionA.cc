#!/bin/bash
# Start local Supabase for development
#
# Usage: ./scripts/start-supabase.sh
#
# Uses ports from .env (configured per worktree).
# Validates environment before starting.

set -e

# Source validation
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/validate-env.sh"

# Validate environment (will exit if prod detected)
validate_env

# Source .env to get ports
set -a
source "$ENV_FILE"
set +a

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Docker is not running${NC}"
    echo "Please start Docker Desktop and try again."
    exit 1
fi

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}ERROR: Supabase CLI is not installed${NC}"
    echo ""
    echo "Install with:"
    echo "  brew install supabase/tap/supabase"
    exit 1
fi

# Verify config.toml has correct ports (should match .env)
CONFIG_FILE="$PROJECT_ROOT/supabase/config.toml"
if [[ -f "$CONFIG_FILE" ]]; then
    CONFIG_API_PORT=$(grep -E "^port = [0-9]+" "$CONFIG_FILE" | head -1 | grep -oE "[0-9]+")
    if [[ "$CONFIG_API_PORT" != "$PORT_SUPABASE_API" ]]; then
        echo -e "${YELLOW}WARNING: supabase/config.toml ports don't match .env${NC}"
        echo "  Config API port: $CONFIG_API_PORT"
        echo "  .env API port:   $PORT_SUPABASE_API"
        echo ""
        echo "Regenerating config.toml..."
        "$SCRIPT_DIR/generate-env-local.sh" "${WORKTREE_INDEX:-0}"
    fi
fi

echo ""
echo -e "${BLUE}Starting Supabase...${NC}"
echo "  API:     http://localhost:$PORT_SUPABASE_API"
echo "  DB:      localhost:$PORT_SUPABASE_DB"
echo "  Studio:  http://localhost:$PORT_SUPABASE_STUDIO"
echo ""

# Start Supabase
cd "$PROJECT_ROOT/supabase"
supabase start

echo ""
echo -e "${GREEN}✓ Supabase is running!${NC}"
echo ""
echo "Connection details:"
supabase status
