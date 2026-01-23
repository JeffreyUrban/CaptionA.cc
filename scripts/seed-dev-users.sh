#!/bin/bash
# Seed development users for local Supabase
#
# Creates:
# - admin@local.dev (password: adminpass123) - Platform admin with full access
# - user@local.dev (password: userpass123) - Regular user with active access
#
# Usage: ./scripts/seed-dev-users.sh
#
# Prerequisites:
# - Supabase running locally (supabase start)
# - .env file with PORT_SUPABASE_API

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

# Default ports if not set
PORT_SUPABASE_API="${PORT_SUPABASE_API:-6010}"
PORT_SUPABASE_DB="${PORT_SUPABASE_DB:-6011}"

# Get actual keys from Supabase CLI (they're dynamically generated)
echo -e "${BLUE}Getting Supabase configuration...${NC}"
SUPABASE_STATUS=$(cd "$PROJECT_ROOT/supabase" && supabase status -o json 2>/dev/null)

if [ -z "$SUPABASE_STATUS" ]; then
    echo -e "${RED}ERROR: Could not get Supabase status. Is Supabase running?${NC}"
    exit 1
fi

# Parse JSON using Python (more reliable than grep for complex JSON)
SUPABASE_URL=$(echo "$SUPABASE_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['API_URL'])" 2>/dev/null)
SERVICE_ROLE_KEY=$(echo "$SUPABASE_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])" 2>/dev/null)

if [ -z "$SERVICE_ROLE_KEY" ]; then
    echo -e "${RED}ERROR: Could not get SERVICE_ROLE_KEY from Supabase${NC}"
    exit 1
fi

echo "  API URL: $SUPABASE_URL"

# Test user credentials
ADMIN_EMAIL="admin@local.dev"
ADMIN_PASSWORD="adminpass123"
ADMIN_NAME="Local Admin"

USER_EMAIL="user@local.dev"
USER_PASSWORD="userpass123"
USER_NAME="Local User"

echo ""
echo -e "${BLUE}Seeding development users...${NC}"
echo "  Supabase URL: $SUPABASE_URL"
echo ""

# Function to create a user via Supabase Admin API
create_user() {
    local email="$1"
    local password="$2"
    local full_name="$3"

    echo -e "${BLUE}Creating user: $email${NC}"

    # Create user via Admin API
    response=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
        -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
        -H "apikey: $SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"$email\",
            \"password\": \"$password\",
            \"email_confirm\": true,
            \"user_metadata\": {
                \"full_name\": \"$full_name\"
            }
        }")

    # Extract user ID from response
    user_id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [ -n "$user_id" ] && [ "$user_id" != "null" ]; then
        echo -e "${GREEN}✓ Created user: $email (ID: $user_id)${NC}"
        echo "$user_id"
    else
        # Check if user already exists
        if echo "$response" | grep -q "already been registered"; then
            echo -e "${YELLOW}User already exists: $email${NC}"
            # Get existing user ID
            existing=$(curl -s -X GET "$SUPABASE_URL/auth/v1/admin/users" \
                -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
                -H "apikey: $SERVICE_ROLE_KEY" | \
                grep -o "\"id\":\"[^\"]*\",\"aud\":\"[^\"]*\",\"role\":\"[^\"]*\",\"email\":\"$email\"" | \
                head -1 | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
            if [ -n "$existing" ]; then
                echo -e "${GREEN}✓ Found existing user ID: $existing${NC}"
                echo "$existing"
            fi
        else
            echo -e "${RED}Failed to create user: $email${NC}"
            echo "Response: $response"
            return 1
        fi
    fi
}

# Function to run SQL via Supabase
run_sql() {
    local sql="$1"

    # Use psql to run SQL directly against local Supabase DB
    PGPASSWORD=postgres psql -h localhost -p "${PORT_SUPABASE_DB:-6011}" -U postgres -d postgres -c "$sql" 2>/dev/null
}

echo ""
echo -e "${BLUE}Step 1: Creating users via Supabase Auth...${NC}"
echo ""

# Create admin user
ADMIN_ID=$(create_user "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_NAME")

# Create regular user
USER_ID=$(create_user "$USER_EMAIL" "$USER_PASSWORD" "$USER_NAME")

if [ -z "$ADMIN_ID" ] || [ -z "$USER_ID" ]; then
    echo -e "${RED}Failed to create users. Check Supabase is running.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Step 2: Setting up user profiles and permissions...${NC}"
echo ""

# Note: The handle_new_user() trigger should have already created user_profiles
# We just need to update them with correct roles and add platform_admin entry

# Update admin user profile to owner with active tier
run_sql "
UPDATE captionacc.user_profiles
SET role = 'owner',
    approval_status = 'approved',
    access_tier_id = 'active'
WHERE id = '$ADMIN_ID';
"

# Grant platform admin to admin user
run_sql "
INSERT INTO captionacc.platform_admins (user_id, admin_level, notes)
VALUES ('$ADMIN_ID', 'super_admin', 'Local dev admin')
ON CONFLICT (user_id) DO UPDATE SET
  admin_level = 'super_admin',
  revoked_at = NULL;
"

# Update regular user profile with active tier
run_sql "
UPDATE captionacc.user_profiles
SET role = 'member',
    approval_status = 'approved',
    access_tier_id = 'active'
WHERE id = '$USER_ID';
"

echo -e "${GREEN}✓ User profiles updated${NC}"

echo ""
echo -e "${BLUE}Step 3: Creating invite codes...${NC}"
echo ""

# Create invite codes for testing
run_sql "
INSERT INTO captionacc.invite_codes (code, created_by, max_uses, expires_at)
VALUES
  ('DEV-ADMIN-CODE', '$ADMIN_ID', 100, NOW() + INTERVAL '1 year'),
  ('DEV-USER-CODE', '$ADMIN_ID', 100, NOW() + INTERVAL '1 year')
ON CONFLICT (code) DO NOTHING;
"

echo -e "${GREEN}✓ Invite codes created${NC}"

echo ""
echo -e "${BLUE}Step 4: Verifying setup...${NC}"
echo ""

# Verify setup
run_sql "
SELECT
  u.email,
  up.full_name,
  up.role,
  up.approval_status,
  up.access_tier_id,
  pa.admin_level as platform_admin
FROM auth.users u
JOIN captionacc.user_profiles up ON up.id = u.id
LEFT JOIN captionacc.platform_admins pa ON pa.user_id = u.id AND pa.revoked_at IS NULL
WHERE u.email IN ('$ADMIN_EMAIL', '$USER_EMAIL')
ORDER BY pa.admin_level DESC NULLS LAST;
"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Development users seeded successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Admin Account:"
echo "  Email:    $ADMIN_EMAIL"
echo "  Password: $ADMIN_PASSWORD"
echo "  Role:     Platform Admin (super_admin)"
echo ""
echo "User Account:"
echo "  Email:    $USER_EMAIL"
echo "  Password: $USER_PASSWORD"
echo "  Role:     Regular User (member)"
echo ""
echo "Invite Codes (for testing signup):"
echo "  DEV-ADMIN-CODE"
echo "  DEV-USER-CODE"
echo ""
echo "Login at: http://localhost:${PORT_WEB:-6000}/login"
echo ""
