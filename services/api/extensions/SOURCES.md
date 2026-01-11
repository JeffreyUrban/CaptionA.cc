# CR-SQLite Extension Sources

## Current Version
- **Release Tag:** prebuild-test.main-438663b8
- **Release Date:** 2025-12-23
- **Source Repository:** https://github.com/superfly/cr-sqlite (Fly.io fork)
- **Upstream:** https://github.com/vlcn-io/cr-sqlite

## Download URLs (GitHub - Source)
- **macOS ARM64:** https://github.com/superfly/cr-sqlite/releases/download/prebuild-test.main-438663b8/crsqlite-darwin-aarch64.zip
- **macOS x86_64:** https://github.com/superfly/cr-sqlite/releases/download/prebuild-test.main-438663b8/crsqlite-darwin-x86_64.zip
- **Linux ARM64:** https://github.com/superfly/cr-sqlite/releases/download/prebuild-test.main-438663b8/crsqlite-linux-aarch64.zip
- **Linux x86_64:** https://github.com/superfly/cr-sqlite/releases/download/prebuild-test.main-438663b8/crsqlite-linux-x86_64.zip

## Download URLs (Wasabi Mirror - Production)
- **macOS ARM64:** https://s3.wasabisys.com/caption-acc-prod/artifacts/cr-sqlite/prebuild-test.main-438663b8/darwin-aarch64/crsqlite.dylib
- **Linux x86_64:** https://s3.wasabisys.com/caption-acc-prod/artifacts/cr-sqlite/prebuild-test.main-438663b8/linux-x86_64/crsqlite.so
- **Latest pointer:** https://s3.wasabisys.com/caption-acc-prod/artifacts/cr-sqlite/LATEST.txt

## SHA256 Checksums (prebuild-test.main-438663b8)
```
darwin-aarch64/crsqlite.dylib: 1f11beea9831efd94b2edb051f33e6336d7c85d0934be9ef23bbb3a68f638db1
linux-x86_64/crsqlite.so:      80743eea1e5bf613dbbefa644eab39ec5c15d9326fa5c9aedecf9d0f65921a16

# Verify after download:
# shasum -a 256 darwin-aarch64/crsqlite.dylib
# shasum -a 256 linux-x86_64/crsqlite.so
```

## Installation
```bash
# Download and extract (example for macOS ARM64)
curl -L -o crsqlite.zip https://github.com/superfly/cr-sqlite/releases/download/prebuild-test.main-438663b8/crsqlite-darwin-aarch64.zip
unzip crsqlite.zip -d darwin-aarch64/
rm crsqlite.zip
```

## Upgrade Process
1. Check https://github.com/superfly/cr-sqlite/releases for new versions
2. Update `RELEASE_TAG` in `download.sh` and `Dockerfile`
3. Run `./download.sh all` to download new binaries for both platforms
4. Verify extensions work locally
5. Run `./upload-to-wasabi.sh <new-release-tag>` to mirror to Wasabi
6. Update this file with new release tag and URLs
7. Commit the updated PROVENANCE.txt files
8. Test in staging before production deployment
