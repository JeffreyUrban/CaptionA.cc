#!/bin/bash
# Validate .env file for local development
# - Checks .env exists
# - Fails loudly if prod configuration detected
# - Verifies required variables are present
#
# Usage: source this script from other scripts
#   source "$(dirname "$0")/validate-env.sh"
#   validate_env  # Call the function

set -e

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Get project root
# Try multiple methods to find the project root
if [[ -n "${BASH_SOURCE[0]}" && "${BASH_SOURCE[0]}" != "" ]]; then
    # When sourced directly
    _SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
elif [[ -f "./scripts/validate-env.sh" ]]; then
    # Running from project root
    PROJECT_ROOT="$(pwd)"
elif [[ -f "../scripts/validate-env.sh" ]]; then
    # Running from scripts directory
    PROJECT_ROOT="$(cd .. && pwd)"
else
    # Fallback: search for package.json
    PROJECT_ROOT="$(pwd)"
    while [[ "$PROJECT_ROOT" != "/" && ! -f "$PROJECT_ROOT/package.json" ]]; do
        PROJECT_ROOT="$(dirname "$PROJECT_ROOT")"
    done
fi
ENV_FILE="$PROJECT_ROOT/.env"

validate_env() {
    local errors=()

    # Check .env exists
    if [[ ! -f "$ENV_FILE" ]]; then
        echo -e "${RED}ERROR: .env file not found${NC}"
        echo ""
        echo "Create .env by either:"
        echo "  1. Symlink to .env.local:   ln -sf .env.local .env"
        echo "  2. Generate for worktree:   ./scripts/generate-env-local.sh <worktree-index>"
        echo ""
        exit 1
    fi

    # Source .env to check values
    set -a
    source "$ENV_FILE"
    set +a

    # === PROD DETECTION ===
    # Fail loudly if any prod indicators are found

    # Check WASABI_BUCKET
    if [[ "$WASABI_BUCKET" == *"-prod"* ]]; then
        errors+=("WASABI_BUCKET contains '-prod': $WASABI_BUCKET")
    fi

    # Check WASABI_STS_ROLE_ARN
    if [[ "$WASABI_STS_ROLE_ARN" == *"captionacc-prod"* ]]; then
        errors+=("WASABI_STS_ROLE_ARN contains 'captionacc-prod'")
    fi

    # Check PREFECT_WORK_POOL
    if [[ "$PREFECT_WORK_POOL" == *"-prod"* ]]; then
        errors+=("PREFECT_WORK_POOL contains '-prod': $PREFECT_WORK_POOL")
    fi

    # Check VITE_API_URL
    if [[ "$VITE_API_URL" == *"captionacc-api-prod"* ]]; then
        errors+=("VITE_API_URL contains 'captionacc-api-prod': $VITE_API_URL")
    fi

    # Check Supabase (known prod project ID)
    if [[ "$SUPABASE_URL" == *"cuvzwbtarrkngqeqmdaz"* ]]; then
        errors+=("SUPABASE_URL is production project: $SUPABASE_URL")
    fi

    # If any prod indicators found, fail loudly
    if [[ ${#errors[@]} -gt 0 ]]; then
        echo -e "${RED}=======================================${NC}"
        echo -e "${RED}ERROR: PRODUCTION CONFIGURATION DETECTED${NC}"
        echo -e "${RED}=======================================${NC}"
        echo ""
        echo "The dev setup detected production configuration in .env:"
        echo ""
        for error in "${errors[@]}"; do
            echo -e "  ${RED}✗${NC} $error"
        done
        echo ""
        echo "Dev setup requires dev/local environment configuration."
        echo "Switch .env to point to .env.local or .env.staging"
        echo ""
        exit 1
    fi

    # === REQUIRED VARIABLES ===
    local missing=()

    [[ -z "$SUPABASE_URL" ]] && missing+=("SUPABASE_URL")
    [[ -z "$SUPABASE_ANON_KEY" ]] && missing+=("SUPABASE_ANON_KEY")

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${RED}ERROR: Missing required environment variables${NC}"
        echo ""
        for var in "${missing[@]}"; do
            echo -e "  ${RED}✗${NC} $var"
        done
        echo ""
        exit 1
    fi

    echo -e "${GREEN}✓${NC} Environment validated (not prod, required vars present)"
}

# Detect environment type from .env
detect_env_type() {
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "none"
        return
    fi

    set -a
    source "$ENV_FILE"
    set +a

    # Local: Supabase URL is localhost
    if [[ "$SUPABASE_URL" == *"localhost"* ]] || [[ "$SUPABASE_URL" == *"127.0.0.1"* ]]; then
        echo "local"
        return
    fi

    # Staging: Known staging project ID
    if [[ "$SUPABASE_URL" == *"okxgkojcukqjzlrqrmox"* ]]; then
        echo "staging"
        return
    fi

    # Prod: Known prod project ID (shouldn't get here if validate_env passed)
    if [[ "$SUPABASE_URL" == *"cuvzwbtarrkngqeqmdaz"* ]]; then
        echo "prod"
        return
    fi

    echo "unknown"
}

# Export functions for use by other scripts
export -f validate_env
export -f detect_env_type
export PROJECT_ROOT
export ENV_FILE
