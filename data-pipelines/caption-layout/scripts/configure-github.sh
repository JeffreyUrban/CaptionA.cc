#!/usr/bin/env bash

# Configure GitHub repository settings
# This script sets up branch protection, merge strategy, and other repository settings
# Requires: GitHub CLI (gh) to be installed and authenticated

set -euo pipefail

# Disable pager for gh commands (prevents interactive prompts)
export GH_PAGER=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get repository information
REPO_NAME="${1:-}"
if [ -z "$REPO_NAME" ]; then
    # Try to detect from git remote
    if git remote get-url origin &>/dev/null; then
        REPO_URL=$(git remote get-url origin)
        # Extract owner/repo from various GitHub URL formats (including SSH config aliases)
        # Handles: git@github.com:owner/repo.git, git@github.com-alias:owner/repo.git, https://github.com/owner/repo.git
        REPO_NAME=$(echo "$REPO_URL" | sed -E 's|.*github\.com[^:]*:||' | sed -E 's|.*/github\.com/||' | sed 's|\.git$||')
    else
        echo -e "${RED}Error: Could not detect repository name${NC}"
        echo "Usage: $0 [OWNER/REPO]"
        echo "Example: $0 JeffreyUrban/my-project"
        exit 1
    fi
fi

echo -e "${GREEN}Configuring GitHub repository: $REPO_NAME${NC}\n"

# Check if gh is installed and authenticated
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

if ! gh auth status &>/dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub CLI${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Function to run gh commands with error handling
run_gh_command() {
    local description="$1"
    shift
    echo -e "${YELLOW}→${NC} $description"
    if "$@"; then
        echo -e "${GREEN}✓${NC} Success\n"
        return 0
    else
        echo -e "${RED}✗${NC} Failed\n"
        return 1
    fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Repository Settings"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Enable all merge methods with squash as default
run_gh_command "Configuring merge methods (all enabled, squash as default)" \
    gh api -X PATCH "repos/$REPO_NAME" \
    -f allow_squash_merge=true \
    -f allow_merge_commit=true \
    -f allow_rebase_merge=true \
    -f squash_merge_commit_title=PR_TITLE \
    -f squash_merge_commit_message=COMMIT_MESSAGES

run_gh_command "Enabling automatic branch deletion after merge" \
    gh api -X PATCH "repos/$REPO_NAME" \
    -f delete_branch_on_merge=true

run_gh_command "Enabling auto-merge" \
    gh api -X PATCH "repos/$REPO_NAME" \
    -f allow_auto_merge=true

run_gh_command "Enabling branch update suggestions" \
    gh api -X PATCH "repos/$REPO_NAME" \
    -f allow_update_branch=true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Branch Protection for 'main'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if main branch exists on remote
if ! gh api "repos/$REPO_NAME/branches/main" &>/dev/null; then
    echo -e "${YELLOW}Note: 'main' branch does not exist on remote yet${NC}"
    echo -e "${YELLOW}Creating empty commit and pushing to initialize branch...${NC}\n"

    # Create empty commit if no commits exist
    if ! git rev-parse HEAD &>/dev/null; then
        git commit --allow-empty -m "Initial commit"
    fi

    # Push to create the branch on remote
    git push -u origin main
    echo -e "${GREEN}✓${NC} Branch 'main' created on remote\n"
fi

# Check if branch protection already exists
if gh api "repos/$REPO_NAME/branches/main/protection" &>/dev/null; then
    echo -e "${YELLOW}Note: Branch protection already exists. Updating...${NC}\n"
fi

# Configure branch protection for main branch
# Note: required_status_checks can be added after CI workflows are set up
echo -e "${YELLOW}→${NC} Configuring branch protection rules"
if gh api -X PUT "repos/$REPO_NAME/branches/main/protection" --silent --input - <<EOF
{
  "required_status_checks": {
    "strict": false,
    "contexts": []
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
then
    echo -e "${GREEN}✓${NC} Success\n"
else
    echo -e "${RED}✗${NC} Failed\n"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Configuration Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓${NC} Merge methods: All enabled (merge commits, squash, rebase)"
echo -e "${GREEN}✓${NC} Default merge method: Squash"
echo -e "${GREEN}✓${NC} Branch update suggestions: Enabled"
echo -e "${GREEN}✓${NC} Auto-delete branches: Enabled"
echo -e "${GREEN}✓${NC} Auto-merge: Enabled"
echo -e "${GREEN}✓${NC} Branch protection on main:"
echo "  - Force pushes: Disabled"
echo "  - Branch deletion: Disabled"
echo "  - Enforce for admins: Enabled"
echo ""
echo -e "${YELLOW}Note:${NC} Required status checks are not configured yet."
echo "After setting up GitHub Actions workflows, you can add them with:"
echo ""
echo "  gh api -X PATCH repos/$REPO_NAME/branches/main/protection/required_status_checks \\"
echo "    -F strict=false \\"
echo "    -f 'contexts[]=quality' \\"
echo "    -f 'contexts[]=link-check' \\"
echo "    -f 'contexts[]=test (3.14)' \\"
echo "    -f 'contexts[]=test (3.14)' \\"
echo "    -f 'contexts[]=docs/readthedocs.org:caption-layout'"
echo ""
echo "# When full Python version matrix is enabled in test.yml, add:"
echo "#   -f 'contexts[]=test ()' \\"
echo "#   -f 'contexts[]=test ()' \\"
echo "#   -f 'contexts[]=test ()' \\"
echo "#   -f 'contexts[]=test ()' \\"
echo ""
echo -e "${GREEN}Configuration complete!${NC}"
