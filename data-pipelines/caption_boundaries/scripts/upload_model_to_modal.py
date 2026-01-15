#!/usr/bin/env python3
"""Upload model checkpoint to Modal volume.

This script uploads a trained model checkpoint to Modal's persistent volume
so it can be loaded by the inference service.

Usage:
    python scripts/upload_model_to_modal.py \
        --checkpoint local/models/caption_boundaries/fusion_lora_spatial_mrn0fkfd.pt \
        --model-version mrn0fkfd

    # With custom volume name
    python scripts/upload_model_to_modal.py \
        --checkpoint path/to/model.pt \
        --model-version v2 \
        --volume boundary-models-dev
"""

import argparse
import hashlib
from pathlib import Path

try:
    import modal
except ImportError:
    print("❌ Modal not installed. Install with: pip install modal")
    print("   Then authenticate with: modal token new")
    exit(1)

# Create Modal app at module level for deployment
app = modal.App("upload-checkpoint")

# Get volume reference
volume = modal.Volume.from_name("boundary-models", create_if_missing=True)


@app.function(volumes={"/models": volume}, timeout=600)
def upload_checkpoint_to_volume(remote_path: str, file_contents: bytes) -> dict:
    """Upload checkpoint file to Modal volume.

    This function runs on Modal with the volume mounted.
    The file contents are sent via the function call.
    """
    from pathlib import Path

    # Full path in mounted volume
    dest_path = Path("/models") / remote_path.lstrip("/")

    # Create parent directories
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Write file
    dest_path.write_bytes(file_contents)

    # Verify
    if dest_path.exists():
        size = dest_path.stat().st_size
        return {"success": True, "size": size, "path": remote_path}
    else:
        return {"success": False, "error": "File not found after upload"}


def compute_file_hash(filepath: Path, chunk_size: int = 8192) -> str:
    """Compute SHA256 hash of file."""
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(chunk_size):
            sha256.update(chunk)
    return sha256.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Upload model checkpoint to Modal volume")
    parser.add_argument(
        "--checkpoint",
        required=True,
        type=Path,
        help="Path to model checkpoint file (.pt)",
    )
    parser.add_argument(
        "--model-version",
        required=True,
        help="Model version identifier (e.g., mrn0fkfd, v1, etc.)",
    )
    parser.add_argument(
        "--volume",
        default="boundary-models",
        help="Modal volume name (default: boundary-models)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite if checkpoint already exists",
    )

    args = parser.parse_args()

    # Validate checkpoint file
    if not args.checkpoint.exists():
        print(f"❌ Checkpoint file not found: {args.checkpoint}")
        exit(1)

    if not args.checkpoint.suffix == ".pt":
        print(f"⚠️  Warning: Expected .pt file, got {args.checkpoint.suffix}")

    # Compute file hash for verification
    print("📊 Computing file hash...")
    file_hash = compute_file_hash(args.checkpoint)
    file_size_mb = args.checkpoint.stat().st_size / (1024 * 1024)

    print("\n📦 Model Checkpoint Details:")
    print(f"   File: {args.checkpoint.name}")
    print(f"   Size: {file_size_mb:.1f} MB")
    print(f"   Hash: {file_hash[:16]}...")
    print(f"   Version: {args.model_version}")

    # Create volume filename with hash for verification
    remote_filename = f"{args.model_version}_{file_hash[:8]}.pt"
    remote_path = f"/checkpoints/{remote_filename}"

    print("\n🚀 Uploading to Modal...")
    print(f"   Volume: {args.volume}")
    print(f"   Path: {remote_path}")

    try:
        # Get or create volume
        volume = modal.Volume.from_name(args.volume, create_if_missing=True)

        # Check if file already exists
        try:
            existing_files = list(volume.listdir("/checkpoints"))
            if remote_filename in existing_files:
                if not args.force:
                    print("\n⚠️  Checkpoint already exists in volume!")
                    print("   Use --force to overwrite")
                    exit(1)
                else:
                    print("   Overwriting existing checkpoint...")
        except Exception:
            # Directory might not exist yet, that's fine
            pass

        # Read file contents
        print("   Reading file...")
        with open(args.checkpoint, "rb") as f:
            file_contents = f.read()

        print(f"   File size: {len(file_contents) / (1024 * 1024):.1f} MB")

        # Upload using Modal function
        print("   Uploading to Modal volume...")

        with app.run():
            result = upload_checkpoint_to_volume.remote(remote_path, file_contents)

        if result["success"]:
            uploaded_size_mb = result["size"] / (1024 * 1024)
            print("\n✅ Upload successful!")
            print(f"   Uploaded: {uploaded_size_mb:.1f} MB")
            print(f"   Location: {result['path']}")

            # Verify size matches
            if abs(uploaded_size_mb - file_size_mb) > 0.1:
                print("\n⚠️  WARNING: Size mismatch!")
                print(f"   Local: {file_size_mb:.1f} MB")
                print(f"   Remote: {uploaded_size_mb:.1f} MB")
            else:
                print("   ✓ Size verified")

            # Print usage instructions
            print("\n📝 To use this checkpoint in inference:")
            print(f"   Model version: {args.model_version}")
            print(f"   Checkpoint hash: {file_hash[:8]}")
            print("\n   The inference service will automatically load from:")
            print(f"   /models{result['path']}")
        else:
            print(f"\n❌ Upload failed: {result.get('error', 'Unknown error')}")
            exit(1)

    except Exception as e:
        print(f"\n❌ Upload failed: {e}")
        import traceback

        traceback.print_exc()
        exit(1)

    # List all checkpoints in volume
    print(f"\n📁 All checkpoints in volume '{args.volume}':")
    try:
        checkpoints = list(volume.listdir("/checkpoints"))
        if checkpoints:
            for cp in sorted(checkpoints):
                print(f"   - {cp}")
        else:
            print(f"   - {remote_filename} (just uploaded)")
    except Exception:
        print(f"   - {remote_filename} (just uploaded)")

    print("\n✅ Model checkpoint ready for inference!")


if __name__ == "__main__":
    main()
