# Data and Model Versioning

This document describes our approach to versioning datasets and trained models while keeping the public GitHub repository free of large binary files and proprietary data.

## Overview

We use **DVC (Data Version Control)** for dataset and model versioning, combined with **Weights & Biases (W&B) Model Registry** for tracking trained models with full metadata. This approach ensures:

- Public GitHub repository contains only code and lightweight metadata
- Large datasets and model weights stored in private remote storage
- Full traceability from deployed models back to training data and code
- Reproducible ML pipelines with versioned dependencies

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Public GitHub Repo                    │
│  • Source code                                          │
│  • .dvc files (metadata only, ~100 bytes each)         │
│  • dvc.yaml (pipeline definitions)                      │
│  • .gitignore (blocks data/models)                      │
└─────────────────────────────────────────────────────────┘
                          │
                          │ References via hash
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Private DVC Remote Storage                  │
│  • AWS S3 / Google Cloud Storage / Network Drive        │
│  • boundaries.db (datasets)                             │
│  • checkpoints/*.pt (trained models)                    │
│  • Access controlled via IAM/credentials                │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Logged during training
                          ▼
┌─────────────────────────────────────────────────────────┐
│           W&B Model Registry (Private)                   │
│  • Model artifacts with full metadata                   │
│  • Links to dataset version (DVC hash)                  │
│  • Links to code version (git commit)                   │
│  • Training metrics and hyperparameters                 │
└─────────────────────────────────────────────────────────┘
```

## DVC Setup

### Initial Configuration

```bash
# Navigate to project root
cd /Users/jurban/PycharmProjects/CaptionA.cc

# Initialize DVC (one-time setup)
dvc init

# Configure remote storage in .dvc/config (just declares it exists)
dvc remote add -d storage myremote

# Configure remote URL and credentials in .dvc/config.local (NOT committed)
# This keeps the S3 bucket name private
dvc remote modify storage url s3://caption-boundaries-data/dvc-storage --local
dvc remote modify storage access_key_id YOUR_ACCESS_KEY --local
dvc remote modify storage secret_access_key YOUR_SECRET_KEY --local

# Commit DVC configuration (without remote details or credentials)
git add .dvc/config .dvcignore
git commit -m "Initialize DVC with remote storage"
```

**What gets committed vs what stays private:**

`.dvc/config` (committed to Git - public):
```ini
[core]
    remote = storage
['remote "storage"]
    # No URL or credentials here!
```

`.dvc/config.local` (gitignored - private):
```ini
['remote "storage"]
    url = s3://caption-boundaries-data/dvc-storage
    access_key_id = AKIAXXXXXXXXXXXXXXXX
    secret_access_key = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

This keeps your bucket name, server paths, and credentials completely private.

### Alternative Remote Storage Options

**Google Cloud Storage:**
```bash
dvc remote add -d storage myremote
dvc remote modify storage url gs://caption-boundaries-data/dvc-storage --local
dvc remote modify storage credentialpath /path/to/credentials.json --local
```

**Local Network Drive:**
```bash
dvc remote add -d storage myremote
dvc remote modify storage url /mnt/shared-storage/caption-boundaries/dvc-storage --local
```

**SSH Server:**
```bash
dvc remote add -d storage myremote
dvc remote modify storage url ssh://user@server/path/to/storage --local
dvc remote modify storage password YOUR_PASSWORD --local
```

**Note:** In all cases above, the actual storage location (URL) is stored in `.dvc/config.local` which is gitignored, keeping your infrastructure details private.

### Tracking Datasets

```bash
# Track the boundaries database
cd data-pipelines/caption_boundaries
dvc add local/data/boundaries.db

# This creates boundaries.db.dvc (metadata file)
# Add to git, but NOT the actual .db file
git add local/data/boundaries.db.dvc local/data/.gitignore
git commit -m "Track boundaries dataset v1.0"

# Push data to remote storage
dvc push

# Tag the dataset version
git tag -a data-v1.0 -m "Initial boundaries dataset"
git push origin data-v1.0
```

### Tracking Model Checkpoints

```bash
# Track entire checkpoints directory
dvc add checkpoints/

# Commit metadata
git add checkpoints.dvc .gitignore
git commit -m "Track model checkpoints"

# Push to remote
dvc push
```

## W&B Model Registry Integration

### Extended Training Script

The trainer automatically logs models to W&B with full metadata:

```python
# In caption_boundaries/training/trainer.py
def _save_checkpoint(self, epoch: int, metrics: dict, is_best: bool = False):
    """Save checkpoint and log to W&B."""
    checkpoint_path = self.checkpoint_dir / f"checkpoint_epoch_{epoch}.pt"

    checkpoint = {
        "epoch": epoch,
        "model_state_dict": self.model.state_dict(),
        "optimizer_state_dict": self.optimizer.state_dict(),
        "scheduler_state_dict": self.scheduler.state_dict() if self.scheduler else None,
        "metrics": metrics,
        "config": self.config,
    }

    torch.save(checkpoint, checkpoint_path)

    # Log to W&B with full metadata
    if wandb.run is not None:
        artifact = wandb.Artifact(
            name=f"{self.config.model_name}-checkpoint",
            type="model",
            metadata={
                "epoch": epoch,
                "architecture": self.config.model_name,
                "dataset_version": self._get_dataset_dvc_hash(),  # DVC hash
                "git_commit": self._get_git_commit(),              # Code version
                "metrics": metrics,
                "hyperparameters": {
                    "learning_rate": self.config.learning_rate,
                    "batch_size": self.config.batch_size,
                    "num_epochs": self.config.num_epochs,
                },
            },
        )
        artifact.add_file(str(checkpoint_path))
        wandb.log_artifact(artifact, aliases=["latest", "best"] if is_best else ["latest"])

def _get_dataset_dvc_hash(self) -> str:
    """Get DVC hash of the dataset for traceability."""
    import subprocess
    result = subprocess.run(
        ["dvc", "get-url", "--rev", "HEAD", "local/data/boundaries.db.dvc"],
        capture_output=True,
        text=True,
    )
    # Parse and return hash from .dvc file
    import yaml
    dvc_data = yaml.safe_load(result.stdout)
    return dvc_data.get("outs", [{}])[0].get("md5", "unknown")

def _get_git_commit(self) -> str:
    """Get current git commit hash."""
    import subprocess
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()
```

### Loading Models for Inference

```python
# caption_boundaries/inference/model_loader.py
import wandb
from pathlib import Path
import torch
from caption_boundaries.models.registry import create_model

def load_model_from_wandb(
    artifact_name: str,
    device: str = "cuda",
    entity: str = "your-team",
    project: str = "caption-boundaries",
) -> tuple[torch.nn.Module, dict]:
    """Load model from W&B Model Registry.

    Returns:
        model: Loaded model
        metadata: Full metadata including dataset version and git commit
    """
    # Download artifact
    api = wandb.Api()
    artifact = api.artifact(f"{entity}/{project}/{artifact_name}:best")
    artifact_dir = artifact.download()

    # Load checkpoint
    checkpoint_path = Path(artifact_dir) / f"checkpoint_epoch_{artifact.metadata['epoch']}.pt"
    checkpoint = torch.load(checkpoint_path, map_location=device)

    # Recreate model
    model = create_model(
        artifact.metadata["architecture"],
        num_classes=5,
        device=device,
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    return model, artifact.metadata

def verify_data_version(metadata: dict) -> bool:
    """Verify that current dataset matches the one used for training."""
    import subprocess
    import yaml

    # Get current dataset DVC hash
    result = subprocess.run(
        ["dvc", "get-url", "--rev", "HEAD", "local/data/boundaries.db.dvc"],
        capture_output=True,
        text=True,
    )
    dvc_data = yaml.safe_load(result.stdout)
    current_hash = dvc_data.get("outs", [{}])[0].get("md5", "")

    # Compare with training dataset
    training_hash = metadata["dataset_version"]

    if current_hash != training_hash:
        print(f"⚠️  Warning: Dataset mismatch!")
        print(f"   Training dataset: {training_hash}")
        print(f"   Current dataset:  {current_hash}")
        return False

    print(f"✓ Dataset version matches: {current_hash}")
    return True
```

## Git Hooks for Safety

We use multiple layers of pre-commit hooks to prevent accidentally committing data/model files to Git:

1. **Extension-based blocking** - Fast fail on specific file extensions (`.db`, `.pt`, `.mp4`, etc.)
2. **File size checking** - Block any file larger than 1MB
3. **Pattern matching** - Check file contents and directory paths for forbidden terms
4. **Custom validation** - Python script with comprehensive checks

This defense-in-depth approach ensures no data files slip through.

### Installation

```bash
# Install pre-commit framework
pip install pre-commit

# Create pre-commit configuration
cat > .pre-commit-config.yaml << 'EOF'
repos:
  - repo: local
    hooks:
      # Layer 1: Fast extension-based blocking
      - id: block-database-files
        name: Block database files
        entry: Database files must be tracked with DVC, not Git
        language: fail
        files: '\.(db|db-shm|db-wal|sqlite|sqlite3)$'

      - id: block-model-files
        name: Block model checkpoint files
        entry: Model files must be tracked with DVC, not Git
        language: fail
        files: '\.(pt|pth|ckpt|safetensors|bin|h5|pkl|pickle)$'

      - id: block-video-files
        name: Block video files
        entry: Video files must not be committed to Git
        language: fail
        files: '\.(mp4|avi|mov|mkv|wmv|flv|webm)$'

      # Layer 2: Comprehensive custom validation
      - id: prevent-data-commits
        name: Prevent data/model commits (comprehensive)
        entry: scripts/check-no-data-in-commit.py
        language: system
        pass_filenames: false
        always_run: true

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      # Layer 3: File size checking
      - id: check-added-large-files
        args: ['--maxkb=1000']  # 1MB limit
        exclude: '^(\.dvc/|.*\.dvc)$'  # Allow .dvc metadata files

      # General checks
      - id: end-of-file-fixer
      - id: check-merge-conflict
      - id: check-yaml
        args: ['--unsafe']  # Allow custom YAML tags

  # Python code quality
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.9
    hooks:
      - id: ruff
        args: [--fix, --exit-non-zero-on-fix]
      - id: ruff-format
EOF

# Install hooks
pre-commit install
```

### Custom Data Protection Hook

Create `scripts/check-no-data-in-commit.py`:

```python
#!/usr/bin/env python3
"""Pre-commit hook to prevent committing data/model files."""

import subprocess
import sys
from pathlib import Path

# File patterns that should NEVER be committed
FORBIDDEN_PATTERNS = [
    "*.db",
    "*.db-shm",
    "*.db-wal",
    "*.pt",
    "*.pth",
    "*.safetensors",
    "*.ckpt",
    "*.bin",  # Model files
    "*.mp4",
    "*.avi",
    "*.mov",
    "*.mkv",  # Video files
]

# Directories that should be DVC-tracked only
FORBIDDEN_DIRS = [
    "local/data/",
    "checkpoints/",
    "wandb/local-runs/",  # Local W&B files
]

def get_staged_files():
    """Get list of files staged for commit."""
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip().split("\n") if result.stdout else []

def check_file(filepath: str) -> bool:
    """Check if file should be blocked.

    Returns:
        True if file is OK to commit, False if blocked
    """
    path = Path(filepath)

    # Check forbidden directories
    for forbidden_dir in FORBIDDEN_DIRS:
        if str(path).startswith(forbidden_dir):
            print(f"❌ BLOCKED: {filepath}")
            print(f"   Reason: Files in {forbidden_dir} must be tracked with DVC")
            print(f"   Use: dvc add {filepath}")
            return False

    # Check forbidden patterns
    for pattern in FORBIDDEN_PATTERNS:
        if path.match(pattern):
            # Allow .dvc files (metadata)
            if not filepath.endswith(".dvc"):
                print(f"❌ BLOCKED: {filepath}")
                print(f"   Reason: {pattern} files must be tracked with DVC")
                print(f"   Use: dvc add {filepath}")
                return False

    # Check file size (belt and suspenders with pre-commit's check-added-large-files)
    if path.exists() and path.stat().st_size > 1_000_000:  # 1MB
        print(f"❌ BLOCKED: {filepath}")
        print(f"   Reason: File is {path.stat().st_size / 1_000_000:.1f}MB (limit: 1MB)")
        print(f"   Large files should be tracked with DVC")
        return False

    return True

def main():
    """Main pre-commit hook logic."""
    staged_files = get_staged_files()

    if not staged_files:
        return 0

    blocked_files = []

    for filepath in staged_files:
        if not filepath:  # Skip empty strings
            continue

        if not check_file(filepath):
            blocked_files.append(filepath)

    if blocked_files:
        print("\n" + "=" * 70)
        print("⚠️  COMMIT BLOCKED: Data/model files detected")
        print("=" * 70)
        print("\nThe following files should be tracked with DVC, not Git:")
        for f in blocked_files:
            print(f"  • {f}")
        print("\nTo fix:")
        print("  1. Unstage files: git reset HEAD <file>")
        print("  2. Track with DVC: dvc add <file>")
        print("  3. Commit .dvc file: git add <file>.dvc")
        print("  4. Push to DVC remote: dvc push")
        print("\nSee docs/data-and-model-versioning.md for details")
        print("=" * 70 + "\n")
        return 1

    print("✓ No data/model files in commit")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Make it executable:

```bash
chmod +x scripts/check-no-data-in-commit.py
```

### Testing the Hooks

```bash
# Test hooks on all files
pre-commit run --all-files

# Try to commit a database file (blocked by extension)
touch test.db
git add test.db
git commit -m "Test commit"
# Block database files....................................................Failed
# - hook id: block-database-files
# - exit code: 1
#
# Database files must be tracked with DVC, not Git

# Try to commit a model file (blocked by extension)
touch model.pt
git add model.pt
git commit -m "Test commit"
# Block model checkpoint files............................................Failed
# - hook id: block-model-files
# - exit code: 1
#
# Model files must be tracked with DVC, not Git

# Try to commit in local/data/ (blocked by custom script)
touch local/data/test.db
git add local/data/test.db
git commit -m "Test commit"
# Prevent data/model commits (comprehensive)..............................Failed
# - hook id: prevent-data-commits
#
# ❌ BLOCKED: local/data/test.db
#    Reason: Files in local/data/ must be tracked with DVC
```

**How the layers work together:**

1. **Extension check fails first** (fastest) - Immediate rejection of `.db`, `.pt`, etc.
2. **If extension passes**, custom script checks directory paths and patterns
3. **If both pass**, file size is checked as final safeguard
4. **All must pass** for commit to succeed

## Project Structure

```
CaptionA.cc/
├── .git/                          # Git repository
├── .dvc/                          # DVC configuration
│   ├── config                     # Remote storage config (committed)
│   ├── config.local               # Credentials (NOT committed)
│   └── .gitignore                 # Prevents committing cache
├── .gitignore                     # Blocks data/models
├── .pre-commit-config.yaml        # Pre-commit hooks config
├── dvc.yaml                       # DVC pipeline definitions
├── dvc.lock                       # DVC pipeline lock file
│
├── data-pipelines/
│   ├── docs/
│   │   └── data-and-model-versioning.md  # This file
│   │
│   └── caption_boundaries/
│       ├── local/data/
│       │   ├── boundaries.db         # NOT committed (tracked by DVC)
│       │   ├── boundaries.db.dvc     # Committed (metadata only)
│       │   └── .gitignore            # Auto-generated by DVC
│       │
│       ├── checkpoints/
│       │   ├── *.pt                  # NOT committed (tracked by DVC)
│       │   ├── .gitignore            # Blocks *.pt files
│       │   └── (tracked via dvc add checkpoints/)
│       │
│       └── src/caption_boundaries/
│           ├── training/trainer.py   # Logs to W&B
│           └── inference/model_loader.py
│
└── scripts/
    └── check-no-data-in-commit.py    # Pre-commit hook
```

## Workflows

### For Development (You and Teammates)

**Initial Setup:**
```bash
# Clone repository
git clone https://github.com/yourname/CaptionA.cc.git
cd CaptionA.cc

# Install dependencies
pip install -r requirements.txt
pip install pre-commit

# Install git hooks
pre-commit install

# Configure DVC remote URL and credentials (provided by team)
dvc remote modify storage url s3://caption-boundaries-data/dvc-storage --local
dvc remote modify storage access_key_id YOUR_KEY --local
dvc remote modify storage secret_access_key YOUR_SECRET --local

# Pull datasets and models
dvc pull
```

**Training a New Model:**
```bash
# Make code changes
vim data-pipelines/caption_boundaries/src/...

# Train model (automatically logs to W&B)
python train.py

# Track new checkpoint with DVC
dvc add checkpoints/checkpoint_epoch_50.pt
git add checkpoints/checkpoint_epoch_50.pt.dvc
git commit -m "Add epoch 50 checkpoint"
dvc push

# Push code changes
git push
```

**Updating Dataset:**
```bash
# Modify dataset
python build_dataset.py

# Update DVC tracking
dvc add local/data/boundaries.db
git add local/data/boundaries.db.dvc
git commit -m "Update dataset: add 1000 new samples"
dvc push

# Tag dataset version
git tag -a data-v1.1 -m "Added 1000 samples from Show XYZ"
git push origin data-v1.1
```

### For Public Users (Open Source)

Public users can access the code but not the data:

```bash
# Clone repository
git clone https://github.com/yourname/CaptionA.cc.git
cd CaptionA.cc

# They get:
# ✓ Source code
# ✓ .dvc metadata files
# ✓ Documentation

# They DON'T get:
# ✗ boundaries.db (only have .dvc file)
# ✗ Model checkpoints (only have .dvc file)

# If they try to run:
python train.py
# ❌ FileNotFoundError: boundaries.db not found

# They can:
# • Study the code architecture
# • Adapt it for their own datasets
# • Report issues
# • Contribute code improvements
```

### For Deployment/Inference

```bash
# In production environment
from caption_boundaries.inference.model_loader import load_model_from_wandb, verify_data_version

# Load best model from W&B
model, metadata = load_model_from_wandb(
    artifact_name="channel_fusion_lora_spatial_clip-checkpoint",
    device="cuda",
)

# Verify data version matches
verify_data_version(metadata)

# Use model
predictions = model(ocr_viz, frame1, frame2, spatial_features)
```

## DVC Pipeline (Optional)

For full reproducibility, define the entire ML pipeline in `dvc.yaml`:

```yaml
stages:
  build_dataset:
    cmd: python -m caption_boundaries.data.dataset_builder --output local/data/boundaries.db
    deps:
      - caption_boundaries/data/dataset_builder.py
      - caption_boundaries/database/schema.py
    outs:
      - local/data/boundaries.db:
          cache: true
          desc: "Caption boundaries training dataset"

  train:
    cmd: >
      python -m caption_boundaries.training.train
        --model channel_fusion_lora_spatial_clip
        --epochs 100
        --batch-size 32
        --learning-rate 0.001
    deps:
      - local/data/boundaries.db
      - caption_boundaries/training/trainer.py
      - caption_boundaries/models/architectures/
    params:
      - training.learning_rate
      - training.batch_size
      - training.num_epochs
    outs:
      - checkpoints/:
          cache: true
          desc: "Trained model checkpoints"
    metrics:
      - metrics.json:
          cache: false
```

Run the pipeline:
```bash
# Run entire pipeline
dvc repro

# Run specific stage
dvc repro train

# Show metrics
dvc metrics show

# Compare experiments
dvc exp show
```

## Security Checklist

Before making the repository public, verify:

- [ ] `.gitignore` includes all data/model patterns
- [ ] Pre-commit hooks installed and tested
- [ ] DVC remote storage is private (S3 bucket, etc.)
- [ ] DVC remote URL in `.dvc/config.local` (not `.dvc/config`) - keeps bucket name private
- [ ] DVC credentials in `.dvc/config.local` (not `.dvc/config`)
- [ ] `.dvc/config.local` is in `.gitignore`
- [ ] W&B project is set to "Private"
- [ ] No `.db`, `.pt`, or video files in git history
- [ ] Test: Fresh clone doesn't include any data files
- [ ] Test: Pre-commit hook blocks data file commits
- [ ] Verify `.dvc/config` has no bucket/server names or credentials

**Check git history for leaks:**
```bash
# Check for large files in history
git rev-list --objects --all | \
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | \
  sed -n 's/^blob //p' | \
  sort --numeric-sort --key=2 | \
  tail -20

# If large files found, remove from history:
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch local/data/boundaries.db" \
  --prune-empty --tag-name-filter cat -- --all
```

## Benefits

1. **Public code, private data** - Share implementation without exposing proprietary datasets
2. **Full traceability** - Every deployed model links back to exact data version and code commit
3. **Reproducibility** - Anyone with credentials can reproduce training exactly
4. **Efficient storage** - Git stays small; large files in object storage
5. **Safety** - Pre-commit hooks prevent accidents
6. **Collaboration** - Team members sync data/models with `dvc pull`
7. **CI/CD ready** - DVC integrates with GitHub Actions for automated pipelines

## References

- [DVC Documentation](https://dvc.org/doc)
- [W&B Model Registry](https://docs.wandb.ai/guides/model_registry)
- [Pre-commit Hooks](https://pre-commit.com/)
- [Git LFS vs DVC Comparison](https://dvc.org/doc/user-guide/what-is-dvc#comparison)
