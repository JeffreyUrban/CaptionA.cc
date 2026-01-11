#!/bin/bash
# Download CR-SQLite extensions from Superfly fork releases
# Run from the extensions/ directory
# Source: https://github.com/superfly/cr-sqlite/releases

set -e

RELEASE_TAG="prebuild-test.main-438663b8"
BASE_URL="https://github.com/superfly/cr-sqlite/releases/download/${RELEASE_TAG}"
REPO_URL="https://github.com/superfly/cr-sqlite"

echo "Downloading CR-SQLite ${RELEASE_TAG}..."

# Function to write provenance file
write_provenance() {
    local dir="$1"
    local artifact="$2"
    local zip_url="$3"
    local sha256=$(shasum -a 256 "${dir}/${artifact}" | cut -d' ' -f1)

    cat > "${dir}/PROVENANCE.txt" << EOF
CR-SQLite Extension Provenance
==============================
Artifact:     ${artifact}
Release Tag:  ${RELEASE_TAG}
Repository:   ${REPO_URL}
Download URL: ${zip_url}
Downloaded:   $(date -u +"%Y-%m-%dT%H:%M:%SZ")
SHA256:       ${sha256}
EOF
    echo "  -> ${dir}/PROVENANCE.txt"
}

# macOS ARM64
if [[ "$1" == "darwin" || "$1" == "all" || -z "$1" && "$(uname)" == "Darwin" ]]; then
    echo "Downloading macOS ARM64..."
    mkdir -p darwin-aarch64
    ZIP_URL="${BASE_URL}/crsqlite-darwin-aarch64.zip"
    curl -L -o /tmp/crsqlite-darwin.zip "${ZIP_URL}"
    unzip -o /tmp/crsqlite-darwin.zip -d darwin-aarch64/
    rm /tmp/crsqlite-darwin.zip
    echo "  -> darwin-aarch64/crsqlite.dylib"
    write_provenance "darwin-aarch64" "crsqlite.dylib" "${ZIP_URL}"
fi

# Linux x86_64
if [[ "$1" == "linux" || "$1" == "all" || -z "$1" && "$(uname)" == "Linux" ]]; then
    echo "Downloading Linux x86_64..."
    mkdir -p linux-x86_64
    ZIP_URL="${BASE_URL}/crsqlite-linux-x86_64.zip"
    curl -L -o /tmp/crsqlite-linux.zip "${ZIP_URL}"
    unzip -o /tmp/crsqlite-linux.zip -d linux-x86_64/
    rm /tmp/crsqlite-linux.zip
    echo "  -> linux-x86_64/crsqlite.so"
    write_provenance "linux-x86_64" "crsqlite.so" "${ZIP_URL}"
fi

echo "Done."
