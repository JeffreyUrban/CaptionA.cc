#!/bin/bash
# Snapshot modified databases to DVC (periodic background task)
#
# This script:
# - Detects databases modified since last snapshot
# - Tracks them with DVC
# - Commits .dvc files to git
# - Pushes to DVC storage
#
# Safety: Only runs in main worktree, not branch worktrees

# TODO: The database details in this file are out of date.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Safeguard: Ensure we're in the main worktree
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || echo "")
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || echo "")

if [ "$GIT_COMMON_DIR" != "$GIT_DIR" ]; then
    echo -e "${RED}ERROR: This script must run in the main worktree, not a branch worktree${NC}" >&2
    echo -e "${YELLOW}Current location: $(pwd)${NC}" >&2
    echo -e "${YELLOW}Git common dir: $GIT_COMMON_DIR${NC}" >&2
    echo -e "${YELLOW}Git dir: $GIT_DIR${NC}" >&2
    exit 1
fi

if [[ $(pwd) != *"/CaptionA.cc" ]] || [[ $(pwd) == *"/CaptionA.cc-"* ]]; then
    echo -e "${RED}ERROR: Not in main worktree (CaptionA.cc)${NC}" >&2
    echo -e "${YELLOW}Current: $(pwd)${NC}" >&2
    exit 1
fi

echo -e "${GREEN}✓ Running in main worktree${NC}"

# Change to repository root
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Timestamp for this snapshot
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_LOG="local/dvc-snapshots.log"

# Create log directory if needed
mkdir -p "$(dirname "$SNAPSHOT_LOG")"

# Find all split databases
DB_TYPES=("video.db" "fullOCR.db" "layout.db" "captions.db")
MODIFIED_DBS=()

echo "Collecting all split databases..."

# For first run, just track all databases
# Later runs will check .dvc file timestamps vs database timestamps
for db_type in "${DB_TYPES[@]}"; do
    while IFS= read -r db_file; do
        # Check if .dvc file exists and is newer than database
        dvc_file="${db_file}.dvc"

        if [ ! -f "$dvc_file" ]; then
            # No .dvc file exists - needs tracking
            MODIFIED_DBS+=("$db_file")
        elif [ "$db_file" -nt "$dvc_file" ]; then
            # Database is newer than .dvc file - needs re-tracking
            MODIFIED_DBS+=("$db_file")
        fi
    done < <(find -L !__local/data/_has_been_deprecated__! -name "$db_type" -type f 2>/dev/null)
done

# Count modified databases
NUM_MODIFIED=${#MODIFIED_DBS[@]}

if [ "$NUM_MODIFIED" -eq 0 ]; then
    echo -e "${GREEN}No modified databases since last snapshot. Nothing to do.${NC}"
    exit 0
fi

echo -e "${YELLOW}Found $NUM_MODIFIED modified database(s)${NC}"

# Log snapshot start
echo "[$TIMESTAMP] Starting snapshot of $NUM_MODIFIED database(s)" >> "$SNAPSHOT_LOG"

# Track each modified database with DVC
TRACKED_COUNT=0
FAILED_COUNT=0

for db_file in "${MODIFIED_DBS[@]}"; do
    echo "  Tracking: $db_file"

    if dvc add "$db_file" 2>&1 | tee -a "$SNAPSHOT_LOG"; then
        # Stage the .dvc file
        git add "$db_file.dvc" "$(dirname "$db_file")/.gitignore" 2>/dev/null || true
        ((TRACKED_COUNT++))
        echo "[$TIMESTAMP]   ✓ $db_file" >> "$SNAPSHOT_LOG"
    else
        echo -e "${RED}  ✗ Failed to track: $db_file${NC}"
        echo "[$TIMESTAMP]   ✗ $db_file (failed)" >> "$SNAPSHOT_LOG"
        ((FAILED_COUNT++))
    fi
done

# Commit .dvc files if any were tracked
if [ "$TRACKED_COUNT" -gt 0 ]; then
    echo -e "${GREEN}Tracked $TRACKED_COUNT database(s)${NC}"

    # Create commit message
    COMMIT_MSG="DVC snapshot: $TRACKED_COUNT database(s) - $TIMESTAMP"

    if git commit -m "$COMMIT_MSG" 2>&1 | tee -a "$SNAPSHOT_LOG"; then
        echo -e "${GREEN}✓ Committed .dvc files${NC}"
        echo "[$TIMESTAMP] Committed: $COMMIT_MSG" >> "$SNAPSHOT_LOG"

        # Push to DVC storage in background
        echo "Pushing to DVC storage (background)..."
        nohup dvc push >> "$SNAPSHOT_LOG" 2>&1 &
        DVC_PUSH_PID=$!
        echo "[$TIMESTAMP] DVC push started (PID: $DVC_PUSH_PID)" >> "$SNAPSHOT_LOG"

        # Optional: Push to git remote (uncomment if desired)
        # git push origin main >> "$SNAPSHOT_LOG" 2>&1 &

    else
        echo -e "${YELLOW}No changes to commit (possibly already tracked)${NC}"
    fi
else
    echo -e "${YELLOW}No databases were successfully tracked${NC}"
fi

# Summary
echo ""
echo "=== Snapshot Summary ==="
echo "Modified:  $NUM_MODIFIED"
echo "Tracked:   $TRACKED_COUNT"
echo "Failed:    $FAILED_COUNT"
echo "Log:       $SNAPSHOT_LOG"
echo "======================="

if [ "$FAILED_COUNT" -gt 0 ]; then
    exit 1
fi

exit 0
