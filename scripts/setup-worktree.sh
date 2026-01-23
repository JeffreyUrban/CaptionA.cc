#!/bin/bash
# Project-specific worktree setup for CaptionA.cc
# Called by .claude/scripts/setup-worktree.sh with arguments:
#   $1 = WORKTREE_INDEX
#   $2 = MAIN_WORKTREE path
#   $3 = PROJECT_NAME

set -e

# Colors
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Arguments from generic setup script
WORKTREE_INDEX="${1:-0}"
MAIN_WORKTREE="${2:-$(pwd)}"
PROJECT_NAME="${3:-$(basename "$MAIN_WORKTREE")}"

echo -e "${BLUE}📦 Installing Python dependencies...${NC}"
uv sync --all-extras
echo ""

echo -e "${BLUE}📦 Installing Node dependencies...${NC}"
npm install
echo ""

# Copy database from main worktree if it exists
MAIN_DB="$MAIN_WORKTREE/data/${PROJECT_NAME}.db"
if [[ -f "$MAIN_DB" ]]; then
    echo -e "${BLUE}💾 Copying database from main worktree...${NC}"
    mkdir -p "data"
    cp "$MAIN_DB" "data/${PROJECT_NAME}.db"
    echo -e "${GREEN}   ✓ Database copied${NC}"
else
    echo -e "${YELLOW}   ⚠️  No database found at $MAIN_DB${NC}"
fi
echo ""

# Generate .env.local with worktree-specific ports
echo -e "${BLUE}🔐 Generating .env.local for worktree ${WORKTREE_INDEX}...${NC}"
"$SCRIPT_DIR/generate-env-local.sh" "$WORKTREE_INDEX"
echo ""

echo -e "${GREEN}✓ Project setup complete${NC}"
