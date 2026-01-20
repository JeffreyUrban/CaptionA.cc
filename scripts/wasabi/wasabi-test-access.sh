#!/bin/bash
# Test Wasabi Access Levels
# This script checks what your current credentials can access

set -e

ENDPOINT="https://s3.us-east-1.wasabisys.com"

# Determine which credentials to test
if [ -n "$WASABI_ACCESS_KEY_READONLY" ]; then
    ACCESS_KEY="${WASABI_ACCESS_KEY_READONLY}"
    SECRET_KEY="${WASABI_SECRET_KEY_READONLY}"
    CRED_TYPE="READ-ONLY"
elif [ -n "$WASABI_ACCESS_KEY_READWRITE" ]; then
    ACCESS_KEY="${WASABI_ACCESS_KEY_READWRITE}"
    SECRET_KEY="${WASABI_SECRET_KEY_READWRITE}"
    CRED_TYPE="READ-WRITE"
elif [ -n "$WASABI_ACCESS_KEY" ]; then
    ACCESS_KEY="${WASABI_ACCESS_KEY}"
    SECRET_KEY="${WASABI_SECRET_KEY}"
    CRED_TYPE="UNKNOWN"
else
    echo "❌ No Wasabi credentials found in environment"
    exit 1
fi

echo "🔍 Testing Wasabi Access Levels ($CRED_TYPE Credentials)"
echo "========================================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: List all buckets
echo "Test 1: Can list all buckets?"
if AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
   AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
   aws s3 ls --endpoint-url "$ENDPOINT" > /tmp/wasabi-buckets.txt 2>&1; then
    echo -e "${RED}⚠️  YES - Credentials can see all buckets:${NC}"
    cat /tmp/wasabi-buckets.txt
    BUCKET_COUNT=$(cat /tmp/wasabi-buckets.txt | wc -l | tr -d ' ')
    echo ""
    echo -e "${YELLOW}Found $BUCKET_COUNT bucket(s) in account${NC}"
    echo -e "${RED}🚨 SECURITY RISK: App credentials should NOT see other buckets${NC}"
else
    echo -e "${GREEN}✅ NO - Credentials restricted (good!)${NC}"
fi

echo ""
echo "Test 2: Can access captionacc-prod bucket?"
if AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
   AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
   aws s3 ls s3://captionacc-prod/ --endpoint-url "$ENDPOINT" > /tmp/wasabi-app-bucket.txt 2>&1; then
    echo -e "${GREEN}✅ YES - Can access app bucket (expected)${NC}"
    FILE_COUNT=$(cat /tmp/wasabi-app-bucket.txt | wc -l | tr -d ' ')
    echo "   Found $FILE_COUNT objects/prefixes"
else
    echo -e "${RED}❌ NO - Cannot access app bucket (problem!)${NC}"
    cat /tmp/wasabi-app-bucket.txt
fi

echo ""
echo "Test 3: Can write to captionacc-prod bucket?"
echo "test" > /tmp/test-write.txt
if AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
   AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
   aws s3 cp /tmp/test-write.txt s3://captionacc-prod/test-write-access.txt --endpoint-url "$ENDPOINT" 2>&1; then
    echo -e "${GREEN}✅ YES - Has write access${NC}"

    # Clean up test file
    AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
    AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
    aws s3 rm s3://captionacc-prod/test-write-access.txt --endpoint-url "$ENDPOINT" > /dev/null 2>&1 || true
else
    echo -e "${YELLOW}⚠️  NO - Read-only access${NC}"
fi

echo ""
echo "Test 4: Can delete from captionacc-prod bucket?"
# First create a test file to delete
if AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
   AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
   aws s3 cp /tmp/test-write.txt s3://captionacc-prod/test-delete-access.txt --endpoint-url "$ENDPOINT" 2>&1 > /dev/null; then

    if AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
       AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
       aws s3 rm s3://captionacc-prod/test-delete-access.txt --endpoint-url "$ENDPOINT" 2>&1 > /dev/null; then
        echo -e "${RED}⚠️  YES - Has delete access${NC}"
        echo -e "${RED}🚨 SECURITY RISK: App should use read-only credentials${NC}"
    else
        echo -e "${GREEN}✅ NO - Cannot delete (good!)${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Cannot test (no write access)${NC}"
fi

echo ""
echo "================================"
echo "Summary & Recommendations"
echo "================================"
echo ""

# Read the bucket list to provide recommendations
if [ -f /tmp/wasabi-buckets.txt ]; then
    BUCKET_COUNT=$(cat /tmp/wasabi-buckets.txt | wc -l | tr -d ' ')

    if [ "$BUCKET_COUNT" -gt 1 ]; then
        echo -e "${RED}🚨 CRITICAL: Current credentials can access $BUCKET_COUNT buckets${NC}"
        echo ""
        echo "If these credentials leak, attacker can access:"
        cat /tmp/wasabi-buckets.txt | sed 's/^/  - /'
        echo ""
        echo "Recommended Actions:"
        echo "1. Create restricted IAM user for CaptionA.cc"
        echo "2. Apply IAM policy limiting access to captionacc-prod only"
        echo "3. Update .env with new restricted credentials"
        echo ""
    else
        echo -e "${GREEN}✅ Credentials appear restricted to single bucket${NC}"
    fi
fi

# Recommend appropriate credentials based on what was tested
if [ "$CRED_TYPE" = "READ-ONLY" ]; then
    echo "✅ These credentials are appropriate for: Web app (presigned URLs)"
    echo "❌ Do NOT use for: Orchestrator (needs write access)"
elif [ "$CRED_TYPE" = "READ-WRITE" ]; then
    echo "✅ These credentials are appropriate for: Orchestrator (video processing)"
    echo "❌ Do NOT use for: Web app (principle of least privilege)"
else
    echo "⚠️  Credential type unknown - check your .env configuration"
fi

echo ""
echo "Next steps:"
echo "1. Log into Wasabi Console: https://console.wasabisys.com"
echo "2. Review IAM user policies and access keys"
echo "3. See security documentation in:"
echo "   docs/wasabi/README.md"

# Cleanup
rm -f /tmp/test-write.txt /tmp/wasabi-buckets.txt /tmp/wasabi-app-bucket.txt
