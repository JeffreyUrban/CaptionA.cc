#!/bin/bash
# Generate .env.local for a specific worktree index
#
# Usage: ./scripts/generate-env-local.sh <worktree-index>
#   worktree-index: 0-9 (0 = main worktree)
#
# Reads BASE_PORT and SERVICES from .worktree.config
# Port formula: BASE_PORT + (worktree_index * 100) + service_offset

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get project root
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_FILE="$PROJECT_ROOT/.env.local.template"
OUTPUT_FILE="$PROJECT_ROOT/.env.local"
WORKTREE_CONFIG="$PROJECT_ROOT/.worktree.config"

# Load worktree config
if [[ ! -f "$WORKTREE_CONFIG" ]]; then
    echo -e "${RED}Error: .worktree.config not found${NC}"
    echo "Create .worktree.config with BASE_PORT and SERVICES definitions"
    exit 1
fi

source "$WORKTREE_CONFIG"

if [[ -z "$BASE_PORT" ]]; then
    echo -e "${RED}Error: BASE_PORT not defined in .worktree.config${NC}"
    exit 1
fi

if [[ -z "${SERVICES[*]}" ]]; then
    echo -e "${RED}Error: SERVICES not defined in .worktree.config${NC}"
    exit 1
fi

# Validate arguments
if [[ -z "$1" ]]; then
    echo -e "${RED}Error: Worktree index required${NC}"
    echo ""
    echo "Usage: $0 <worktree-index>"
    echo "  worktree-index: 0-9 (0 = main worktree)"
    echo ""
    echo "Example (BASE_PORT=$BASE_PORT):"
    echo "  $0 0    # Main worktree, port base $BASE_PORT"
    echo "  $0 1    # Worktree 1, port base $((BASE_PORT + 100))"
    exit 1
fi

WORKTREE_INDEX="$1"

# Validate index is 0-9
if ! [[ "$WORKTREE_INDEX" =~ ^[0-9]$ ]]; then
    echo -e "${RED}Error: Worktree index must be 0-9${NC}"
    exit 1
fi

# Check template exists
if [[ ! -f "$TEMPLATE_FILE" ]]; then
    echo -e "${RED}Error: Template file not found: $TEMPLATE_FILE${NC}"
    exit 1
fi

# Calculate port base for this worktree
PORT_BASE=$((BASE_PORT + WORKTREE_INDEX * 100))

echo -e "${BLUE}Generating .env.local for worktree $WORKTREE_INDEX${NC}"
echo "  Port base: $PORT_BASE"
echo "  Services:"

# Build sed arguments and display ports
SED_ARGS=()
SED_ARGS+=("-e" "s/{{WORKTREE_INDEX}}/$WORKTREE_INDEX/g")
SED_ARGS+=("-e" "s/{{PORT_BASE}}/$PORT_BASE/g")

for svc in "${SERVICES[@]}"; do
    name="${svc%%=*}"
    offset="${svc##*=}"
    port=$((PORT_BASE + offset))

    # Export as PORT_<NAME> for templates
    printf "    %-20s %d\n" "$name:" "$port"

    # Add sed substitution for {{PORT_<NAME>}}
    SED_ARGS+=("-e" "s/{{PORT_$name}}/$port/g")
done

echo ""

# Generate .env.local from template
sed "${SED_ARGS[@]}" "$TEMPLATE_FILE" > "$OUTPUT_FILE"

echo -e "${GREEN}✓ Created $OUTPUT_FILE${NC}"

# Copy secrets from main worktree's .env.local or .env.staging
SECRETS_SOURCE=""
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
if [[ "$GIT_COMMON_DIR" != ".git" ]]; then
    MAIN_WORKTREE=$(dirname "$GIT_COMMON_DIR")
    # Prefer .env.local, fall back to .env.staging
    if [[ -s "$MAIN_WORKTREE/.env.local" ]]; then
        SECRETS_SOURCE="$MAIN_WORKTREE/.env.local"
    elif [[ -f "$MAIN_WORKTREE/.env.staging" ]]; then
        SECRETS_SOURCE="$MAIN_WORKTREE/.env.staging"
    fi
fi

if [[ -n "$SECRETS_SOURCE" ]]; then
    echo -e "${BLUE}Copying secrets from $(basename "$SECRETS_SOURCE")...${NC}"

    # List of secret variables to copy
    SECRET_VARS=(
        "WASABI_ACCESS_KEY_READONLY"
        "WASABI_SECRET_KEY_READONLY"
        "WASABI_ACCESS_KEY_READWRITE"
        "WASABI_SECRET_KEY_READWRITE"
        "WASABI_STS_ACCESS_KEY"
        "WASABI_STS_SECRET_KEY"
        "WASABI_STS_ROLE_ARN"
        "DEEPGRAM_API_KEY"
        "VITE_UMAMI_SRC"
        "VITE_UMAMI_WEBSITE_ID"
        "VITE_WEB3FORMS_ACCESS_KEY"
    )

    for var in "${SECRET_VARS[@]}"; do
        # Extract value from secrets source
        value=$(grep "^${var}=" "$SECRETS_SOURCE" 2>/dev/null | cut -d'=' -f2-)
        if [[ -n "$value" ]]; then
            # Replace empty value in generated .env.local
            sed -i.bak "s|^${var}=.*|${var}=${value}|" "$OUTPUT_FILE"
        fi
    done
    rm -f "${OUTPUT_FILE}.bak"

    echo -e "${GREEN}✓ Secrets copied${NC}"
fi

# Generate supabase/config.toml from template (if it exists)
SUPABASE_TEMPLATE="$PROJECT_ROOT/supabase/config.toml.template"
SUPABASE_CONFIG="$PROJECT_ROOT/supabase/config.toml"

if [[ -f "$SUPABASE_TEMPLATE" ]]; then
    sed "${SED_ARGS[@]}" "$SUPABASE_TEMPLATE" > "$SUPABASE_CONFIG"
    echo -e "${GREEN}✓ Created $SUPABASE_CONFIG${NC}"
fi

echo ""

# Create .env symlink if it doesn't exist or points elsewhere
if [[ ! -L "$PROJECT_ROOT/.env" ]] || [[ "$(readlink "$PROJECT_ROOT/.env")" != ".env.local" ]]; then
    echo -e "${BLUE}Creating .env symlink to .env.local${NC}"
    ln -sf .env.local "$PROJECT_ROOT/.env"
    echo -e "${GREEN}✓ Created .env -> .env.local${NC}"
fi

echo ""
echo "Next steps:"
echo "  1. Start local services: Run 'Dev' in JetBrains (or start manually)"
echo ""
