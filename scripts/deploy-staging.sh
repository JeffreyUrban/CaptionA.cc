#!/bin/bash
# Deploy all services to staging environment
# Usage: ./scripts/deploy-staging.sh [web|api|all]
#
# Options:
#   web   - Deploy captionacc-web only
#   api   - Deploy captionacc-api only
#   all   - Deploy both (default)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}       CaptionA.cc Staging Deployment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

deploy_web() {
    echo -e "${BLUE}━━━ Deploying Web ━━━${NC}"
    "$SCRIPT_DIR/deploy-web-staging.sh"
    echo ""
}

deploy_api() {
    echo -e "${BLUE}━━━ Deploying API ━━━${NC}"
    "$SCRIPT_DIR/deploy-api-staging.sh"
    echo ""
}

case "$TARGET" in
    web)
        deploy_web
        ;;
    api)
        deploy_api
        ;;
    all)
        deploy_api
        deploy_web
        ;;
    *)
        echo -e "${RED}Unknown target: $TARGET${NC}"
        echo "Usage: $0 [web|api|all]"
        exit 1
        ;;
esac

echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}       Staging Deployment Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "Staging URLs:"
echo "  • Web: https://captionacc-web-staging.fly.dev"
echo "  • API: https://captionacc-api-staging.fly.dev"
