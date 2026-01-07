"""Modal inference service for boundary detection.

Serverless GPU inference using Modal. Processes frame pairs from VP9/WebM chunks
and stores results as immutable SQLite databases in Wasabi.
"""

import os
from pathlib import Path

try:
    import modal
except ImportError:
    modal = None  # Optional dependency

# Modal app stub
if modal:
    stub = modal.App("boundary-inference")

    # GPU image with dependencies
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install(
            "torch",
            "torchvision",
            "opencv-python-headless",
            "numpy",
            "rich",
            "requests",
        )
        .apt_install("libgl1-mesa-glx", "libglib2.0-0")
    )

    # Model checkpoint volume (persistent across containers)
    model_volume = modal.Volume.from_name("boundary-models", create_if_missing=True)


@stub.function(
    image=image,
    gpu="A10G",  # ~$1.10/hr
    volumes={"/models": model_volume},
    timeout=3600,  # 1 hour
    container_idle_timeout=300,  # 5 min warm period
)
def test_inference():
    """Test function to verify Modal setup.

    Returns:
        Dict with GPU info and test results
    """
    import torch

    # Check GPU availability
    has_cuda = torch.cuda.is_available()
    device = "cuda" if has_cuda else "cpu"

    result = {
        "status": "success",
        "device": device,
        "gpu_available": has_cuda,
    }

    if has_cuda:
        result["gpu_name"] = torch.cuda.get_device_name(0)
        result["gpu_memory"] = f"{torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB"

    return result


@stub.local_entrypoint()
def main():
    """Test Modal deployment locally."""
    print("🚀 Testing Modal inference service...")

    result = test_inference.remote()

    print("\n✅ Test Results:")
    print(f"  Status: {result['status']}")
    print(f"  Device: {result['device']}")
    print(f"  GPU: {result.get('gpu_name', 'N/A')}")
    print(f"  Memory: {result.get('gpu_memory', 'N/A')}")

    if result["gpu_available"]:
        print("\n🎉 GPU inference ready!")
    else:
        print("\n⚠️  No GPU detected (running on CPU)")


if __name__ == "__main__":
    if modal is None:
        print("❌ Modal not installed. Install with: pip install modal")
        exit(1)

    main()
