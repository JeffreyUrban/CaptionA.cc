#!/bin/bash
# Start Supabase for CaptionA.cc development

set -e

echo "🚀 Starting Supabase for CaptionA.cc..."
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI is not installed."
    echo ""
    echo "Install with:"
    echo "  brew install supabase/tap/supabase"
    echo "  or"
    echo "  npm install -g supabase"
    exit 1
fi

# Start Supabase
echo "Starting Supabase services..."
cd supabase
supabase start

echo ""
echo "✅ Supabase is running!"
echo ""
echo "📝 Connection details:"
echo ""
supabase status

echo ""
echo "🌐 Access points:"
echo "   Studio UI: http://localhost:54323"
echo "   API URL:   http://localhost:54321"
echo "   DB URL:    postgresql://postgres:postgres@localhost:54322/postgres"
echo ""
echo "🔑 Environment variables are already configured in .env"
echo ""
echo "Next steps:"
echo "1. Open Studio: http://localhost:54323"
echo "2. Create a demo user in Authentication > Users"
echo "3. Start web app: cd apps/captionacc-web && npm run dev"
echo "4. Start Prefect: cd services/orchestrator && uv run python serve_flows.py"
echo ""
