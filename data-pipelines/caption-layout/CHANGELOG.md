# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No unreleased changes yet.

---

## [0.0.0] - 1970-01-01

### TEMPLATE_PLACEHOLDER

Special thanks to the Python community and the developers of the excellent tools that made this project possible.

---

## Release Process

Releases are automated via GitHub Actions when a version tag is pushed:

1. Update CHANGELOG.md with release notes
2. Create and push Git tag: `git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions automatically:
   - Creates GitHub Release
   - Publishes to PyPI (when configured)
4. Version number is automatically derived from Git tag

[Unreleased]: https://github.com/yourusername/caption-layout/compare/v0.1.1...HEAD
[0.0.0]: https://github.com/yourusername/caption-layout/releases/tag/v0.1.0
