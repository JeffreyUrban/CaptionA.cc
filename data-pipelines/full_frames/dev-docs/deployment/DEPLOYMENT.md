# Deployment and Distribution

**Status**: 

**Prerequisites**: Core features complete, documentation ready

This document outlines the deployment strategy for distributing full-frames to users.

## Overview

full-frames is distributed through multiple channels to reach different user communities:

1. **Prerequisites** - Ensure project is ready for release
2. **PyPI** - Primary Python package distribution (planned)
3. **Homebrew** - macOS/Linux CLI tool distribution (planned)
4. **conda-forge** - Deferred - evaluate based on target audience

## Prerequisites

Ensure the following are completed before proceeding with deployment:

- Restore python testing full matrix in test.yml: `["3.14", "", "", "", "", "3.14"]`
- Add the additional python tests to the required list for branch protection
- Increase the test coverage requirement `--cov-fail-under`

## PyPI Package

**Status**: 

**Current Version**: 

### Release Process

**Modern Approach: Git Tags as Single Source of Truth**

This project uses **dynamic versioning** via `hatch-vcs`, where Git tags automatically determine the version number. No manual version updates needed!

**How it works**:
1. Git tag becomes the version (e.g., `v0.2.0` → version `0.2.0`)
2. Between tags, automatic `.dev` versions (e.g., `0.2.0.dev5+g1234567`)
3. Build process reads version from Git automatically
4. PyPI package gets correct version without manual edits

**Release Workflow**:

1. **Prepare Release**
   ```bash
   # Update CHANGELOG.md with release notes
   vim CHANGELOG.md

   # Commit changelog
   git add CHANGELOG.md
   git commit -m "docs: Prepare v0.2.0 release"
   git push
   ```

2. **Create GitHub Release** (Recommended: Use GitHub UI)
   - Go to: https://github.com/yourusername/full-frames/releases/new
   - Tag: `v0.2.0` (create new tag)
   - Title: `v0.2.0`
   - Description: Copy from CHANGELOG.md
   - Click "Publish release"
   - GitHub Actions automatically triggers

3. **Alternative: Command Line**
   ```bash
   # Create and push tag
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0

   # Manually create GitHub Release via gh CLI
   gh release create v0.2.0 --title "v0.2.0" --notes-file CHANGELOG.md
   ```

4. **Automated Steps** (via GitHub Actions)
   - Runs full test suite
   - Builds package with version from Git tag
   - Creates GitHub Release (if using tag push method)
   - Publishes to PyPI (when trusted publishing configured)

### GitHub Actions Workflow

**Two-stage approach**: GitHub Release first, then PyPI

**Why release-triggered instead of tag-triggered?**
- ✅ GitHub Release created manually/via UI first (with release notes)
- ✅ Allows review before PyPI publication
- ✅ Release notes visible before automation runs
- ✅ Can test the release without publishing to PyPI
- ✅ PyPI publication is the final step, not the first

### Trusted Publishing Setup

PyPI trusted publishing eliminates the need for API tokens:

1. Go to PyPI → Account → Publishing
2. Add new trusted publisher:
   - Owner: `yourusername`
   - Repository: `full-frames`
   - Workflow: `release.yml`
   - Environment: (leave blank)

### Testing with TestPyPI

Before first production release:

```bash
# Build package
python -m build

# Upload to TestPyPI (manual, one-time test)
python -m twine upload --repository testpypi dist/*

# Test installation
pip install --index-url https://test.pypi.org/simple/ --no-deps full_frames

# Verify
full_frames --version
full_frames --help
```

---

## Homebrew Package

**Status**: Ready to implement (PyPI is now published)

### Formula Location

Create separate tap repository: `homebrew-full-frames`

**Repository**: `https://github.com/yourusername/homebrew-full-frames`

### Formula Template

File: `Formula/full-frames.rb`

```ruby
class Uniqseq < Formula
  include Language::Python::Virtualenv

  desc "TEMPLATE_PLACEHOLDER"
  homepage "https://github.com/yourusername/full-frames"
  url "https://files.pythonhosted.org/packages/.../full-frames-0.1.1.tar.gz"
  sha256 "..."  # SHA256 hash of the PyPI tarball (get from PyPI)
  depends_on "python@3.14"

  # List all Python dependencies
  resource "typer" do
    url "https://files.pythonhosted.org/packages/.../typer-0.9.0.tar.gz"
    sha256 "..."
  end

  resource "rich" do
    url "https://files.pythonhosted.org/packages/.../rich-13.0.0.tar.gz"
    sha256 "..."
  end

  def install
    virtualenv_install_with_resources
  end

  test do
    # Basic smoke test
    output = shell_output("#{bin}/full-frames --version")
    assert_match "full-frames version", output

    # Functional test
    (testpath/"test.txt").write("line1\nline2\nline3\nline1\nline2\nline3\n")
    output = shell_output("#{bin}/full-frames --window-size 3 --quiet #{testpath}/test.txt")
    assert_equal "line1\nline2\nline3\n", output
  end
end
```

### Installation

Users will install via:

```bash
brew tap yourusername/full_frames
brew install full_frames
```

### Update Process

After each PyPI release:

1. Update formula with new version and SHA256
2. Test locally: `brew install --build-from-source ./Formula/full-frames.rb`
3. Commit and push formula update
4. Users update: `brew upgrade full-frames`

### Homebrew Core Submission

**Timing**: After tool has matured (6+ months, stable API)

**Requirements** for homebrew-core:
- Established user base
- Stable version (1.0+)
- Active maintenance
- Good documentation
- No dependencies on proprietary services

**Process**:
1. Submit PR to `homebrew/homebrew-core`
2. Address reviewer feedback
3. Maintain formula in homebrew-core (or delegate to Homebrew team)

---

## Release Versioning

### Semantic Versioning

Follow [SemVer 2.0](https://semver.org/):

- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Pre-1.0 Releases

- **0.1.x**: Initial releases, API may change
- **0.2.x**: Stable core features
- **0.3.x**: Advanced features (libraries, filtering)
- **1.0.0**: Stable API, production ready

### Version Bumping

Update version in:
- `pyproject.toml` - `[project] version = "x.y.z"`
- Create git tag: `vx.y.z`
- Update `CHANGELOG.md`

---

## Distribution Channels Summary

| Channel             | Status   | Priority | Target Audience                  |
|---------------------|----------|----------|----------------------------------|
| **PyPI**            | Planned  | High     | Python developers, general users |
| **Homebrew tap**    | Planned  | Medium   | macOS/Linux CLI users            |
| **Homebrew core**   | Future   | Low      | Broader macOS/Linux adoption     |
| **conda-forge**     | Deferred | Low      | Data science community           |
| **GitHub Releases** | Planned  | High     | All users (download artifacts)   |

---

## Maintenance Plan

### Release Cadence

- **Security patches**: Immediate (as needed)
- **Bug fixes**: As needed (patch releases)
- **Features**: Quarterly (minor releases)
- **Major versions**: Annually (or when breaking changes needed)

### Automation

- **PyPI publishing**: Fully automated via GitHub Actions on tag push
- **Homebrew updates**: Manual (update formula after PyPI release)
- **GitHub Releases**: Semi-automated (create release manually, upload artifacts automatically)

### Quality Gates

Before any release:
- ✅ All tests passing (100% pass rate)
- ✅ Code coverage ≥ 95%
- ✅ No known security vulnerabilities
- ✅ Documentation updated
- ✅ CHANGELOG.md updated
- ✅ Version number incremented correctly

---

## Next Steps

1. **PyPI Setup**
   - [ ] Update `pyproject.toml` metadata
   - [ ] Create `CHANGELOG.md`
   - [ ] Configure PyPI trusted publishing
   - [ ] Create release workflow (`.github/workflows/release.yml`)
   - [ ] First production release to PyPI (v0.1.0)

2. **Homebrew Tap** (Current Priority)
   - [ ] Create `homebrew-full-frames` repository
   - [ ] Get SHA256 hash from PyPI for v0.1.0
   - [ ] Generate formula with accurate dependencies
   - [ ] Test formula locally
   - [ ] Document installation in README
   - [ ] Add Homebrew badge to README

3. **Long-term**
   - [ ] Consider homebrew-core submission (after 1.0)
   - [ ] Evaluate conda-forge based on user demand
   - [ ] Set up automated release notes generation
