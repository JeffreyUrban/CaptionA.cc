#!/bin/bash

# Script to register Prefect flows with the Prefect server
# This script creates deployments for all CaptionA.cc processing flows

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PREFECT_API_URL="${PREFECT_API_URL:-https://prefect-service.fly.dev/api}"
WORK_POOL="captionacc-workers"
DEPLOYMENT_NAME="production"

# Flow definitions
declare -A FLOWS=(
    ["captionacc-video-initial-processing"]="services/api/app/flows/video_initial_processing.py:video_initial_processing"
    ["captionacc-crop-and-infer-caption-frame-extents"]="services/api/app/flows/crop_and_infer.py:crop_and_infer"
    ["captionacc-caption-ocr"]="services/api/app/flows/caption_ocr.py:caption_ocr"
)

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Prefect Flow Registration Script${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Verify Prefect is installed
if ! command -v prefect &> /dev/null; then
    echo -e "${RED}Error: prefect command not found${NC}"
    echo "Please install Prefect: pip install prefect"
    exit 1
fi

# Display configuration
echo -e "${YELLOW}Configuration:${NC}"
echo "  PREFECT_API_URL: $PREFECT_API_URL"
echo "  Work Pool: $WORK_POOL"
echo "  Deployment Name: $DEPLOYMENT_NAME"
echo ""

# Export PREFECT_API_URL for prefect commands
export PREFECT_API_URL

# Verify connection to Prefect server
echo -e "${YELLOW}Verifying connection to Prefect server...${NC}"
if ! prefect version &> /dev/null; then
    echo -e "${RED}Error: Cannot connect to Prefect${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Connected to Prefect successfully${NC}"
echo ""

# Check if work pool exists
echo -e "${YELLOW}Checking work pool '$WORK_POOL'...${NC}"
if prefect work-pool inspect "$WORK_POOL" &> /dev/null; then
    echo -e "${GREEN}✓ Work pool '$WORK_POOL' exists${NC}"
else
    echo -e "${YELLOW}⚠ Work pool '$WORK_POOL' not found. Please create it before running flows.${NC}"
    echo "  You can create it with: prefect work-pool create '$WORK_POOL' --type process"
fi
echo ""

# Register each flow
SUCCESS_COUNT=0
FAILURE_COUNT=0
declare -a FAILED_FLOWS

for FLOW_NAME in "${!FLOWS[@]}"; do
    FLOW_PATH="${FLOWS[$FLOW_NAME]}"
    
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Registering flow: $FLOW_NAME${NC}"
    echo "  Path: $FLOW_PATH"
    echo ""
    
    # Build deployment
    echo "  Building deployment..."
    DEPLOYMENT_FILE="${FLOW_NAME}-deployment.yaml"
    
    if prefect deployment build "$FLOW_PATH" \
        --name "$DEPLOYMENT_NAME" \
        --pool "$WORK_POOL" \
        --output "$DEPLOYMENT_FILE" \
        --skip-upload; then
        echo -e "${GREEN}  ✓ Deployment built successfully${NC}"
    else
        echo -e "${RED}  ✗ Failed to build deployment${NC}"
        FAILED_FLOWS+=("$FLOW_NAME")
        ((FAILURE_COUNT++))
        continue
    fi
    
    # Apply deployment
    echo "  Applying deployment..."
    if prefect deployment apply "$DEPLOYMENT_FILE"; then
        echo -e "${GREEN}  ✓ Deployment applied successfully${NC}"
        ((SUCCESS_COUNT++))
        
        # Clean up deployment file
        rm -f "$DEPLOYMENT_FILE"
    else
        echo -e "${RED}  ✗ Failed to apply deployment${NC}"
        FAILED_FLOWS+=("$FLOW_NAME")
        ((FAILURE_COUNT++))
    fi
    
    echo ""
done

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Registration Summary${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Total flows: ${#FLOWS[@]}"
echo -e "  ${GREEN}Successful: $SUCCESS_COUNT${NC}"
if [ $FAILURE_COUNT -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAILURE_COUNT${NC}"
    echo ""
    echo -e "${RED}Failed flows:${NC}"
    for FAILED_FLOW in "${FAILED_FLOWS[@]}"; do
        echo "  - $FAILED_FLOW"
    done
fi
echo ""

if [ $FAILURE_COUNT -eq 0 ]; then
    echo -e "${GREEN}✓ All flows registered successfully!${NC}"
    echo ""
    echo "You can view your deployments with:"
    echo "  prefect deployment ls"
    echo ""
    echo "To run a flow:"
    echo "  prefect deployment run '<flow-name>/<deployment-name>'"
    exit 0
else
    echo -e "${RED}✗ Some flows failed to register${NC}"
    exit 1
fi
