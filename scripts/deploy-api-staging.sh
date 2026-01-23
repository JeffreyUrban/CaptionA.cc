#!/bin/bash
# Deploy captionacc-api to staging environment
# Usage: ./scripts/deploy-api-staging.sh
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

echo -e "${BLUE}🚀 Deploying captionacc-api to staging${NC}"
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
    "SUPABASE_SERVICE_ROLE_KEY"
    "SUPABASE_JWT_SECRET"
    "WASABI_ACCESS_KEY_READWRITE"
    "WASABI_SECRET_KEY_READWRITE"
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

APP_NAME="captionacc-api-staging"
API_DIR="$PROJECT_ROOT/services/api"

# Check app exists
echo -e "${BLUE}Checking Fly.io app...${NC}"
if ! flyctl apps list | grep -q "$APP_NAME"; then
    echo -e "${YELLOW}App '$APP_NAME' not found. Creating...${NC}"
    flyctl apps create "$APP_NAME" --org personal

    # Create volume for data
    echo -e "${BLUE}Creating data volume...${NC}"
    flyctl volumes create captionacc_data_staging --size 1 --region ewr --app "$APP_NAME"
fi

# Configure secrets
echo -e "${BLUE}Configuring secrets...${NC}"
flyctl secrets set \
    SUPABASE_URL="$SUPABASE_URL" \
    SUPABASE_JWT_SECRET="$SUPABASE_JWT_SECRET" \
    SUPABASE_SCHEMA="captionacc" \
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
    WASABI_ACCESS_KEY_ID="$WASABI_ACCESS_KEY_READWRITE" \
    WASABI_SECRET_ACCESS_KEY="$WASABI_SECRET_KEY_READWRITE" \
    WASABI_BUCKET="$WASABI_BUCKET" \
    WASABI_REGION="$WASABI_REGION" \
    WASABI_ENDPOINT_URL="${WASABI_ENDPOINT_URL:-https://s3.wasabisys.com}" \
    --app "$APP_NAME" \
    --stage

# Deploy from project root (to include packages/ocr_box_model)
echo -e "${BLUE}Deploying...${NC}"
cd "$PROJECT_ROOT"
flyctl deploy \
    -c "$API_DIR/fly.staging.toml" \
    --dockerfile "$API_DIR/Dockerfile" \
    --remote-only

echo ""
echo -e "${GREEN}✅ Deployed to https://$APP_NAME.fly.dev${NC}"

# Verify health
echo -e "${BLUE}Verifying deployment...${NC}"
sleep 10
for i in {1..5}; do
    echo "Health check attempt $i/5..."
    if curl -sf -m 10 "https://$APP_NAME.fly.dev/health" > /dev/null; then
        echo -e "${GREEN}✅ Health check passed${NC}"
        exit 0
    fi
    sleep 5
done

echo -e "${YELLOW}⚠️ Health check didn't pass yet, service may still be starting${NC}"
echo "Check: https://$APP_NAME.fly.dev/health"
