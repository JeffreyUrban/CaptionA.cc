#!/bin/bash
# Start local MinIO server for S3-compatible object storage
#
# Usage: ./scripts/start-minio.sh
#
# Uses PORT_MINIO_API and PORT_MINIO_CONSOLE from .env (configured per worktree).
# Data is stored in data/minio/ and persists between restarts.

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

PORT_MINIO_API="${PORT_MINIO_API:-6030}"
PORT_MINIO_CONSOLE="${PORT_MINIO_CONSOLE:-6031}"

# MinIO credentials (local dev only - not secrets)
MINIO_ROOT_USER="minioadmin"
MINIO_ROOT_PASSWORD="minioadmin"

# Container name includes worktree index for isolation
WORKTREE_NAME=$(basename "$(pwd)")
CONTAINER_NAME="minio-${WORKTREE_NAME}"

# Data directory for persistence
DATA_DIR="$PROJECT_ROOT/data/minio"
mkdir -p "$DATA_DIR"

echo ""
echo -e "${BLUE}Starting MinIO (S3-compatible storage)...${NC}"
echo "  API:     http://localhost:$PORT_MINIO_API"
echo "  Console: http://localhost:$PORT_MINIO_CONSOLE"
echo "  Data:    $DATA_DIR"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Docker is not running${NC}"
    echo "Please start Docker Desktop and try again."
    exit 1
fi

# Stop existing container if running
if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    echo -e "${YELLOW}Stopping existing MinIO container...${NC}"
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1 || true
fi

# Remove existing container
docker rm "$CONTAINER_NAME" > /dev/null 2>&1 || true

# Start MinIO
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT_MINIO_API:9000" \
    -p "$PORT_MINIO_CONSOLE:9001" \
    -v "$DATA_DIR:/data" \
    -e "MINIO_ROOT_USER=$MINIO_ROOT_USER" \
    -e "MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD" \
    minio/minio server /data --console-address ":9001"

echo ""
echo -e "${GREEN}✓ MinIO started${NC}"
echo ""
echo "Credentials (local dev only):"
echo "  Access Key: $MINIO_ROOT_USER"
echo "  Secret Key: $MINIO_ROOT_PASSWORD"
echo ""

# Wait for MinIO to be ready
echo -e "${BLUE}Waiting for MinIO to be ready...${NC}"
for i in {1..30}; do
    if curl -s "http://localhost:$PORT_MINIO_API/minio/health/live" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ MinIO is ready${NC}"
        break
    fi
    sleep 1
done

# Create default bucket if it doesn't exist
echo ""
echo -e "${BLUE}Ensuring default bucket exists...${NC}"

# Install mc (MinIO client) in container and create bucket
docker exec "$CONTAINER_NAME" sh -c "
    mc alias set local http://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD 2>/dev/null || true
    mc mb local/captionacc-local 2>/dev/null || true
    mc anonymous set download local/captionacc-local/public 2>/dev/null || true
" 2>/dev/null || echo -e "${YELLOW}Note: Bucket creation may require mc client${NC}"

echo ""
echo -e "${GREEN}✓ MinIO setup complete${NC}"
echo ""
echo "To view MinIO Console: http://localhost:$PORT_MINIO_CONSOLE"
echo "Login with: $MINIO_ROOT_USER / $MINIO_ROOT_PASSWORD"
echo ""
