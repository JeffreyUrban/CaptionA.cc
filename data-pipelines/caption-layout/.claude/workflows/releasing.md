# Release Workflow

Step-by-step workflow for creating releases.

**Inherits from:** [../../CLAUDE.md](../../CLAUDE.md) - Read universal rules first

---

## Overview

Releases are automated via GitHub Actions when tags are pushed. This workflow documents the release preparation and process.

---

## Prerequisites

**Before releasing:**
- All tests passing
- Documentation updated
- CHANGELOG updated (if maintained)
- No outstanding critical bugs

---

## Workflow

### 1. Verify Ready to Release

```bash
pre-commit run --all-files  # Runs tests, quality checks, doc builds
```

### 2. Update Version

**This project uses `hatch-vcs` for automatic versioning from git tags.**

Version is determined by git tags, not manual version files.

### 3. Update CHANGELOG (if maintained)

**Add release section:**
```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature description (NOT "New! Feature X" - avoid marketing language)

### Changed
- Changed behavior description

### Fixed
- Bug fix description

### Removed
- Removed feature description
```

**Style guidelines:**
- Use factual, technical language
- Avoid marketing terms ("New!", "Exciting!", "Amazing!")
- State what changed, not why it's great
- Be concise and specific

### 4. Commit Changes (if any)

If CHANGELOG or other pre-release changes were made:

```bash
git add .
git commit -m "chore: prepare release X.Y.Z"
```

### 5. Create and Push Tag

**Create annotated tag:**
```bash
git tag -a vX.Y.Z -m "Release X.Y.Z"
```

**Push tag:**
```bash
git push origin vX.Y.Z
```

**GitHub Actions will automatically:**
1. Run tests
2. Build package
3. Publish to PyPI
4. Create GitHub release
5. Update Homebrew formula (via separate workflow)

### 6. Verify Release

**Check GitHub Actions:**
- Visit Actions tab
- Verify release workflow completed successfully

**Check PyPI:**
- Visit https://pypi.org/project/caption-layout/
- Verify new version appears

**Test installation:**
```bash
pip install caption-layout=={{version}}
caption-layout --version
```

### 7. Update Homebrew (Automated)

The `update-homebrew` workflow automatically updates the Homebrew formula when:
1. A new release is published on PyPI
2. The workflow can be triggered manually

**Manual trigger (if needed):**
1. Go to Actions → Update Homebrew Formula
2. Click "Run workflow"
3. Enter version number
4. Click "Run workflow"

---

## Hotfix Releases

**For critical bugs in production:**

1. Create hotfix branch from release tag:
```bash
git checkout -b hotfix/vX.Y.Z vX.Y.Z
```

2. Fix bug and test

3. Commit fix:
```bash
git commit -m "fix: critical bug description"
```

4. Tag hotfix:
```bash
git tag -a vX.Y.Z+1 -m "Hotfix: description"
```

5. Push:
```bash
git push origin hotfix/vX.Y.Z
git push origin vX.Y.Z+1
```

6. Merge back to main:
```bash
git checkout main
git merge hotfix/vX.Y.Z
git push origin main
```

---

## Troubleshooting

### Release Workflow Failed

**Check GitHub Actions logs:**
1. Identify which step failed
2. Fix the issue
3. Delete tag locally and remotely
4. Recreate and push tag

**Delete failed tag:**
```bash
git tag -d vX.Y.Z                    # Delete local
git push origin :refs/tags/vX.Y.Z   # Delete remote
```

### PyPI Upload Failed

**Common issues:**
- Version already exists (can't overwrite)
- Invalid credentials
- Package validation failed

**Solution:**
- Fix issue
- Increment version
- Create new tag

### Homebrew Formula Not Updated

**Check update-homebrew workflow:**
1. Verify workflow triggered
2. Check for errors in logs
3. May need to manually trigger
4. Verify PyPI package is available

**Manual formula update:**
See `HOMEBREW_AUTOMATION_SETUP.md` for details

---

## Next Steps

**Related workflows:**
- [Feature Development](./feature-development.md) - Adding features
- [Bug Fixing](./bug-fixing.md) - Fixing bugs
