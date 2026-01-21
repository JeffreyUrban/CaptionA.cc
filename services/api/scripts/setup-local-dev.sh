#!/bin/bash
# Setup script for local development with namespace isolation
#
# This script:
# 1. Creates .env from .env.development.template
# 2. Prints instructions for Supabase schema setup
# 3. Registers dev Prefect deployments
# 4. Deploys dev Modal apps

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$API_DIR")")"

echo "=================================================="
echo "CaptionA.cc Local Development Setup"
echo "=================================================="
echo ""

# Step 1: Create .env from template
echo "Step 1: Setting up .env file"
echo "----------------------------"

if [ -f "$API_DIR/.env" ]; then
    echo "WARNING: .env file already exists at $API_DIR/.env"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping .env creation"
    else
        cp "$API_DIR/.env.development.template" "$API_DIR/.env"
        echo "Created .env from .env.development.template"
    fi
else
    cp "$API_DIR/.env.development.template" "$API_DIR/.env"
    echo "Created .env from .env.development.template"
fi

echo ""
echo "IMPORTANT: Edit $API_DIR/.env and fill in your credentials:"
echo "  - SUPABASE_URL"
echo "  - SUPABASE_JWT_SECRET"
echo "  - SUPABASE_SERVICE_ROLE_KEY"
echo "  - WASABI_ACCESS_KEY_ID"
echo "  - WASABI_SECRET_ACCESS_KEY"
echo "  - WASABI_BUCKET"
echo ""

# Step 2: Supabase schema instructions
echo "Step 2: Supabase Schema Setup"
echo "-----------------------------"
echo ""
echo "Create the 'captionacc_dev' schema in your Supabase project:"
echo ""
echo "  1. Go to Supabase Dashboard > SQL Editor"
echo "  2. Run: CREATE SCHEMA IF NOT EXISTS captionacc_dev;"
echo "  3. Copy all tables/functions from captionacc_prod to captionacc_dev"
echo ""
echo "Or use pg_dump/pg_restore to clone the schema."
echo ""

# Step 3: Register Prefect deployments
echo "Step 3: Register Prefect Deployments"
echo "-------------------------------------"
echo ""
echo "Run the following to register dev deployments:"
echo ""
echo "  cd $API_DIR"
echo "  PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api \\"
echo "    prefect deploy --all --prefect-file prefect-dev.yaml"
echo ""

read -p "Register Prefect deployments now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$API_DIR"
    PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api \
        prefect deploy --all --prefect-file prefect-dev.yaml
    echo "Prefect deployments registered!"
fi

echo ""

# Step 4: Deploy Modal apps
echo "Step 4: Deploy Modal Apps"
echo "-------------------------"
echo ""
echo "Run the following to deploy dev Modal apps:"
echo ""
echo "  # extract-full-frames-and-ocr-dev"
echo "  cd $PROJECT_ROOT/data-pipelines/extract-full-frames-and-ocr"
echo "  modal_app_suffix=dev modal deploy src/extract_full_frames_and_ocr/app.py"
echo ""
echo "  # extract-crop-frames-and-infer-extents-dev"
echo "  cd $PROJECT_ROOT/data-pipelines/extract-crop-frames-and-infer-extents"
echo "  modal_app_suffix=dev modal deploy src/extract_crop_frames_and_infer_extents/app.py"
echo ""

read -p "Deploy Modal apps now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Deploying extract-full-frames-and-ocr-dev..."
    cd "$PROJECT_ROOT/data-pipelines/extract-full-frames-and-ocr"
    modal_app_suffix=dev modal deploy src/extract_full_frames_and_ocr/app.py

    echo "Deploying extract-crop-frames-and-infer-extents-dev..."
    cd "$PROJECT_ROOT/data-pipelines/extract-crop-frames-and-infer-extents"
    modal_app_suffix=dev modal deploy src/extract_crop_frames_and_infer_extents/app.py

    echo "Modal apps deployed!"
fi

echo ""
echo "=================================================="
echo "Setup Complete!"
echo "=================================================="
echo ""
echo "To start the API with dev config:"
echo ""
echo "  cd $API_DIR"
echo "  uvicorn app.main:app --reload"
echo ""
echo "Verify the worker connects to 'captionacc-workers-dev' work pool."
echo ""
