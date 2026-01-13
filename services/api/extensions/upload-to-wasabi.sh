#!/bin/bash
# Upload CR-SQLite extensions to Wasabi for production reliability
# Reads credentials from project root .env file
# Usage: ./upload-to-wasabi.sh [release-tag]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}/../../.."

# Load environment variables from project root .env
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
    # Export only the variables we need (handles values with special chars)
    export WASABI_ACCESS_KEY_READWRITE=$(grep '^WASABI_ACCESS_KEY_READWRITE=' "${PROJECT_ROOT}/.env" | cut -d'=' -f2-)
    export WASABI_SECRET_KEY_READWRITE=$(grep '^WASABI_SECRET_KEY_READWRITE=' "${PROJECT_ROOT}/.env" | cut -d'=' -f2-)
    export WASABI_BUCKET=$(grep '^WASABI_BUCKET=' "${PROJECT_ROOT}/.env" | cut -d'=' -f2-)
else
    echo "Error: ${PROJECT_ROOT}/.env not found"
    exit 1
fi

# Validate required variables
if [[ -z "${WASABI_ACCESS_KEY_READWRITE}" || -z "${WASABI_SECRET_KEY_READWRITE}" || -z "${WASABI_BUCKET}" ]]; then
    echo "Error: Missing required Wasabi credentials in .env"
    echo "Required: WASABI_ACCESS_KEY_READWRITE, WASABI_SECRET_KEY_READWRITE, WASABI_BUCKET"
    exit 1
fi

RELEASE_TAG="${1:-prebuild-test.main-438663b8}"
BUCKET="${WASABI_BUCKET}"
S3_PREFIX="artifacts/cr-sqlite"
WASABI_ENDPOINT="https://s3.wasabisys.com"

# Configure AWS CLI for Wasabi
export AWS_ACCESS_KEY_ID="${WASABI_ACCESS_KEY_READWRITE}"
export AWS_SECRET_ACCESS_KEY="${WASABI_SECRET_KEY_READWRITE}"
export AWS_DEFAULT_REGION="us-east-1"

echo "Uploading CR-SQLite ${RELEASE_TAG} to Wasabi..."
echo "Bucket: s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/"

# Check if local artifacts exist
if [[ ! -f "darwin-aarch64/crsqlite.dylib" && ! -f "linux-x86_64/crsqlite.so" ]]; then
    echo "Error: No local artifacts found. Run ./download.sh first."
    exit 1
fi

# Create release metadata
RELEASE_JSON=$(cat <<EOF
{
    "release_tag": "${RELEASE_TAG}",
    "source_repo": "https://github.com/superfly/cr-sqlite",
    "uploaded_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "platforms": {
        "darwin-aarch64": $([ -f "darwin-aarch64/crsqlite.dylib" ] && echo "true" || echo "false"),
        "linux-x86_64": $([ -f "linux-x86_64/crsqlite.so" ] && echo "true" || echo "false")
    }
}
EOF
)

echo "${RELEASE_JSON}" > /tmp/RELEASE.json

# Upload release metadata
echo "Uploading release metadata..."
aws s3 cp /tmp/RELEASE.json "s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/RELEASE.json" \
    --endpoint-url "${WASABI_ENDPOINT}" \
    --content-type "application/json"

# Upload darwin-aarch64 if exists
if [[ -f "darwin-aarch64/crsqlite.dylib" ]]; then
    echo "Uploading darwin-aarch64..."
    aws s3 cp darwin-aarch64/crsqlite.dylib \
        "s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/darwin-aarch64/crsqlite.dylib" \
        --endpoint-url "${WASABI_ENDPOINT}" \
        --content-type "application/octet-stream"

    if [[ -f "darwin-aarch64/PROVENANCE.txt" ]]; then
        aws s3 cp darwin-aarch64/PROVENANCE.txt \
            "s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/darwin-aarch64/PROVENANCE.txt" \
            --endpoint-url "${WASABI_ENDPOINT}" \
            --content-type "text/plain"
    fi
fi

# Upload linux-x86_64 if exists
if [[ -f "linux-x86_64/crsqlite.so" ]]; then
    echo "Uploading linux-x86_64..."
    aws s3 cp linux-x86_64/crsqlite.so \
        "s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/linux-x86_64/crsqlite.so" \
        --endpoint-url "${WASABI_ENDPOINT}" \
        --content-type "application/octet-stream"

    if [[ -f "linux-x86_64/PROVENANCE.txt" ]]; then
        aws s3 cp linux-x86_64/PROVENANCE.txt \
            "s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/linux-x86_64/PROVENANCE.txt" \
            --endpoint-url "${WASABI_ENDPOINT}" \
            --content-type "text/plain"
    fi
fi

# Update LATEST.txt pointer
echo "Updating LATEST.txt pointer..."
echo "${RELEASE_TAG}" | aws s3 cp - "s3://${BUCKET}/${S3_PREFIX}/LATEST.txt" \
    --endpoint-url "${WASABI_ENDPOINT}" \
    --content-type "text/plain"

echo ""
echo "Done! Artifacts uploaded to:"
echo "  s3://${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/"
echo ""
echo "Download URLs:"
echo "  darwin-aarch64: ${WASABI_ENDPOINT}/${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/darwin-aarch64/crsqlite.dylib"
echo "  linux-x86_64:   ${WASABI_ENDPOINT}/${BUCKET}/${S3_PREFIX}/${RELEASE_TAG}/linux-x86_64/crsqlite.so"

rm -f /tmp/RELEASE.json
