#!/bin/bash
# Quick deployment script for OCR service

set -e

cd "$(dirname "$0")"

echo "🚀 Deploying OCR Service to Fly.io"
echo "=================================="
echo ""

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
    echo "❌ flyctl not found. Install it first:"
    echo "   curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in
if ! flyctl auth whoami &> /dev/null; then
    echo "❌ Not logged in to Fly.io"
    echo "   Run: flyctl auth login"
    exit 1
fi

# Check if app exists
if ! flyctl status &> /dev/null; then
    echo "📝 App not found. Creating new app..."
    flyctl launch --no-deploy

    echo ""
    echo "🔐 Now set your Google Cloud credentials:"
    echo '   flyctl secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /path/to/credentials.json)"'
    echo ""
    read -p "Press enter when ready to deploy..."
fi

# Deploy
echo "📦 Building and deploying..."
flyctl deploy

echo ""
echo "✅ Deployment complete!"
echo ""

# Get URL
APP_URL=$(flyctl info --json | jq -r '.Hostname' 2>/dev/null || echo "")

if [ -n "$APP_URL" ]; then
    echo "🌐 Service URL: https://${APP_URL}"
    echo ""
    echo "Test it:"
    echo "  curl https://${APP_URL}/"
else
    flyctl info
fi
