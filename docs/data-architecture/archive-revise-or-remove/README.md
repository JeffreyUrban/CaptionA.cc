# Data Pipelines Documentation

This directory contains documentation for the CaptionA.cc data processing and model training pipelines.

## Documentation Index

- **[Data and Model Versioning](data-and-model-versioning.md)** - Comprehensive guide to using DVC and W&B Model Registry for versioning datasets and trained models while keeping the public repository clean. Includes setup instructions, git hooks for safety, and workflows for development and deployment.

## Quick Links

### For New Contributors
- Clone the repository and review the versioning documentation to understand how we manage data and models
- Install pre-commit hooks to prevent accidentally committing large files
- Request access to DVC remote storage and W&B project from the team

### For Developers
- See [Data and Model Versioning](data-and-model-versioning.md) for complete workflows
- Use `dvc pull` to sync datasets and model checkpoints
- Pre-commit hooks will block accidental data commits

### For Deployment
- Load models from W&B Model Registry with full traceability
- Verify dataset versions match training data
- See inference section in versioning documentation
