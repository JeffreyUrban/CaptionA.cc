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
    "!__local/data/_has_been_deprecated__!/",
    "local/models/",
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

    # Allow .dvc files and .gitignore files (metadata)
    if filepath.endswith(".dvc") or filepath.endswith(".gitignore"):
        return True

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
            print(f"❌ BLOCKED: {filepath}")
            print(f"   Reason: {pattern} files must be tracked with DVC")
            print(f"   Use: dvc add {filepath}")
            return False

    # Check file size (belt and suspenders with pre-commit's check-added-large-files)
    if path.exists() and path.stat().st_size > 1_000_000:  # 1MB
        print(f"❌ BLOCKED: {filepath}")
        print(f"   Reason: File is {path.stat().st_size / 1_000_000:.1f}MB (limit: 1MB)")
        print("   Large files should be tracked with DVC")
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
        print("\nSee data-pipelines/docs/data-and-model-versioning.md for details")
        print("=" * 70 + "\n")
        return 1

    print("✓ No data/model files in commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
