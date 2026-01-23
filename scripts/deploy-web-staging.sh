#!/bin/bash
# Deploy captionacc-web to staging environment
# Usage: ./scripts/deploy-web-staging.sh
#
# Prerequisites:
#   - flyctl installed and authenticated
#   - .env.staging exists with required vars

set -e

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}🚀 Deploying captionacc-web to staging${NC}"
echo ""

# Check flyctl
if ! command -v flyctl &> /dev/null; then
    echo -e "${RED}Error: flyctl not installed${NC}"
    echo "Install: https://fly.io/docs/hands-on/install-flyctl/"
    exit 1
fi

# Check authentication
if ! flyctl auth whoami &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with Fly.io${NC}"
    echo "Run: flyctl auth login"
    exit 1
fi

# Load staging environment
ENV_FILE="$PROJECT_ROOT/.env.staging"
if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${RED}Error: .env.staging not found${NC}"
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

# Check required vars
REQUIRED_VARS=(
    "SUPABASE_URL"
    "SUPABASE_ANON_KEY"
    "WASABI_BUCKET"
    "WASABI_REGION"
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var}" ]]; then
        MISSING+=("$var")
    fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo -e "${RED}Error: Missing required environment variables:${NC}"
    for var in "${MISSING[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

APP_NAME="captionacc-web-staging"
WEB_DIR="$PROJECT_ROOT/apps/captionacc-web"

# Check app exists
echo -e "${BLUE}Checking Fly.io app...${NC}"
if ! flyctl apps list | grep -q "$APP_NAME"; then
    echo -e "${YELLOW}App '$APP_NAME' not found. Creating...${NC}"
    flyctl apps create "$APP_NAME" --org personal
fi

# Configure secrets
echo -e "${BLUE}Configuring secrets...${NC}"
flyctl secrets set \
    VITE_SUPABASE_URL="$SUPABASE_URL" \
    VITE_SUPABASE_SCHEMA="captionacc" \
    VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
    WASABI_ACCESS_KEY_READONLY="$WASABI_ACCESS_KEY_READONLY" \
    WASABI_SECRET_KEY_READONLY="$WASABI_SECRET_KEY_READONLY" \
    WASABI_BUCKET="$WASABI_BUCKET" \
    WASABI_REGION="$WASABI_REGION" \
    ENVIRONMENT="staging" \
    --app "$APP_NAME"

# Deploy
echo -e "${BLUE}Deploying...${NC}"
cd "$WEB_DIR"
flyctl deploy --remote-only \
    --config fly.staging.toml \
    --build-arg VITE_SUPABASE_URL="$SUPABASE_URL" \
    --build-arg VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
    --build-arg VITE_SUPABASE_SCHEMA="captionacc" \
    --build-arg VITE_API_URL="https://captionacc-api-staging.fly.dev" \
    --build-arg VITE_WASABI_BUCKET="$WASABI_BUCKET" \
    --app "$APP_NAME"

echo ""
echo -e "${GREEN}✅ Deployed to https://$APP_NAME.fly.dev${NC}"
