#!/bin/bash
# Quick setup script for Modal boundary inference service
#
# Usage:
#   ./scripts/setup_modal.sh

set -e

echo "🚀 Modal Boundary Inference Setup"
echo "=================================="
echo ""

# Check if Modal is installed
if ! command -v modal &> /dev/null; then
    echo "❌ Modal CLI not found. Installing..."
    uv pip install modal
else
    echo "✓ Modal CLI installed: $(modal --version)"
fi

echo ""

# Check if authenticated
if ! modal token show &> /dev/null; then
    echo "🔐 Authenticating with Modal..."
    echo "   This will open a browser window to log in."
    echo ""
    modal token new
else
    echo "✓ Already authenticated with Modal"
    modal token show
fi

echo ""
echo "📝 Next steps:"
echo ""
echo "1. Create Modal secrets (if not done):"
echo "   modal secret create wasabi-credentials \\"
echo "     WASABI_ACCESS_KEY=your_key \\"
echo "     WASABI_SECRET_KEY=your_secret \\"
echo "     WASABI_BUCKET=captionacc-prod \\"
echo "     WASABI_REGION=us-east-1 \\"
echo "     WASABI_ENDPOINT=https://s3.us-east-1.wasabisys.com"
echo ""
echo "   modal secret create supabase-credentials \\"
echo "     SUPABASE_URL=your_url \\"
echo "     SUPABASE_SERVICE_ROLE_KEY=your_key \\"
echo "     SUPABASE_SCHEMA=captionacc_production"
echo ""
echo "2. Upload model checkpoint:"
echo "   python scripts/upload_model_to_modal.py \\"
echo "     --checkpoint local/models/caption_boundaries/fusion_lora_spatial_mrn0fkfd.pt \\"
echo "     --model-version mrn0fkfd"
echo ""
echo "3. Deploy inference service:"
echo "   modal deploy src/caption_boundaries/inference/service.py"
echo ""
echo "4. Test inference:"
echo "   modal run src/caption_boundaries/inference/service.py::test_inference"
echo ""
echo "See docs/MODAL_SETUP.md for detailed instructions."
echo ""
