"""Modal inference service for boundary detection.

Serverless GPU inference using Modal. Processes frame pairs from VP9/WebM chunks
and stores results as immutable SQLite databases in Wasabi.
"""

import os
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

try:
    import modal
except ImportError:
    modal = None  # Optional dependency


@dataclass
class InferenceMetrics:
    """Metrics for tracking inference performance."""

    # Timing
    container_start_time: float  # Timestamp when container started
    cold_start_duration_ms: float | None = None  # Time to cold start container
    model_load_duration_ms: float | None = None  # Time to load model
    total_job_duration_ms: float | None = None  # End-to-end job time

    # Processing
    total_frame_pairs: int = 0  # Number of pairs processed
    successful_inferences: int = 0  # Number of successful inferences
    failed_inferences: int = 0  # Number of failed inferences

    # Throughput
    avg_inference_time_ms: float | None = None  # Average time per frame pair
    pairs_per_second: float | None = None  # Throughput rate

    # Resource usage
    peak_memory_mb: float | None = None  # Peak GPU memory usage
    gpu_utilization_avg: float | None = None  # Average GPU utilization

    def to_dict(self) -> dict:
        """Convert metrics to dictionary for logging."""
        return {
            "cold_start_ms": self.cold_start_duration_ms,
            "model_load_ms": self.model_load_duration_ms,
            "total_job_ms": self.total_job_duration_ms,
            "total_pairs": self.total_frame_pairs,
            "successful": self.successful_inferences,
            "failed": self.failed_inferences,
            "avg_inference_ms": self.avg_inference_time_ms,
            "pairs_per_second": self.pairs_per_second,
            "peak_memory_mb": self.peak_memory_mb,
            "gpu_utilization": self.gpu_utilization_avg,
        }

    def compute_derived_metrics(self, inference_start: float, inference_end: float):
        """Compute throughput and averages."""
        if self.successful_inferences > 0:
            total_inference_time = (inference_end - inference_start) * 1000  # ms
            self.avg_inference_time_ms = total_inference_time / self.successful_inferences
            self.pairs_per_second = self.successful_inferences / ((inference_end - inference_start) or 1)


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

    # Shared metrics tracking across container lifetime
    # Note: This persists across function calls within the same container
    _container_start_time = None
    _is_cold_start = True


@stub.function(
    image=image,
    gpu="A10G",  # ~$1.10/hr
    volumes={"/models": model_volume},
    timeout=3600,  # 1 hour
    container_idle_timeout=300,  # 5 min warm period
)
def test_inference():
    """Test function to verify Modal setup and measure cold start.

    Returns:
        Dict with GPU info, test results, and performance metrics
    """
    global _container_start_time, _is_cold_start
    import torch

    # Track container initialization
    function_start = time.time()
    if _container_start_time is None:
        _container_start_time = function_start
        cold_start_ms = 0  # First call, container just started
        is_cold = True
    else:
        # Warm start - container already running
        cold_start_ms = (function_start - _container_start_time) * 1000
        is_cold = False

    # Measure model/GPU initialization
    init_start = time.time()

    # Check GPU availability
    has_cuda = torch.cuda.is_available()
    device = "cuda" if has_cuda else "cpu"

    # Get GPU info
    gpu_info = {}
    if has_cuda:
        gpu_info = {
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
            "gpu_memory_allocated_mb": round(torch.cuda.memory_allocated(0) / 1024**2, 1),
        }

    init_duration_ms = (time.time() - init_start) * 1000

    # Toggle cold start flag after first call
    if _is_cold_start:
        _is_cold_start = False

    result = {
        "status": "success",
        "device": device,
        "gpu_available": has_cuda,
        **gpu_info,
        "metrics": {
            "is_cold_start": is_cold,
            "cold_start_ms": cold_start_ms if is_cold else None,
            "initialization_ms": init_duration_ms,
            "container_uptime_s": function_start - _container_start_time if _container_start_time else 0,
            "timestamp": datetime.now().isoformat(),
        },
    }

    return result


@stub.function(
    image=image,
    gpu="A10G",
    volumes={"/models": model_volume},
    timeout=3600,
    container_idle_timeout=300,
)
def run_boundary_inference_batch(
    video_id: str,
    tenant_id: str,
    cropped_frames_version: int,
    model_version: str,
    run_id: str,
    frame_pairs: list[tuple[int, int]],
) -> dict:
    """Run inference on batch of frame pairs with detailed metrics.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        cropped_frames_version: Frame version number
        model_version: Model checkpoint hash
        run_id: Inference run UUID
        frame_pairs: List of (frame1_index, frame2_index) tuples

    Returns:
        Dict with results and performance metrics
    """
    global _container_start_time, _is_cold_start
    import torch

    # Initialize metrics
    job_start = time.time()

    if _container_start_time is None:
        _container_start_time = job_start
        is_cold = True
        cold_start_ms = 0
    else:
        is_cold = _is_cold_start
        cold_start_ms = (job_start - _container_start_time) * 1000 if is_cold else None

    metrics = InferenceMetrics(
        container_start_time=_container_start_time,
        cold_start_duration_ms=cold_start_ms,
        total_frame_pairs=len(frame_pairs),
    )

    # TODO: Implement actual inference
    # This is a placeholder that will be filled in Phase 3

    # Measure model loading (placeholder)
    model_load_start = time.time()
    # model = load_model(model_version)  # TODO
    time.sleep(0.1)  # Simulate model loading
    metrics.model_load_duration_ms = (time.time() - model_load_start) * 1000

    # Simulate inference
    inference_start = time.time()
    results = []

    for i, (frame1, frame2) in enumerate(frame_pairs):
        pair_start = time.time()

        # TODO: Actual inference
        # result = predict_pair(frame1, frame2)

        # Placeholder
        result = {
            "frame1_index": frame1,
            "frame2_index": frame2,
            "forward_predicted_label": "same",
            "forward_confidence": 0.95,
            "backward_predicted_label": "same",
            "backward_confidence": 0.93,
            "processing_time_ms": (time.time() - pair_start) * 1000,
        }

        results.append(result)
        metrics.successful_inferences += 1

        # Log progress every 1000 pairs
        if (i + 1) % 1000 == 0:
            elapsed = time.time() - inference_start
            rate = (i + 1) / elapsed
            print(f"Progress: {i + 1}/{len(frame_pairs)} pairs ({rate:.1f} pairs/sec)")

    inference_end = time.time()

    # Compute derived metrics
    metrics.compute_derived_metrics(inference_start, inference_end)
    metrics.total_job_duration_ms = (time.time() - job_start) * 1000

    # Get GPU memory stats
    if torch.cuda.is_available():
        metrics.peak_memory_mb = torch.cuda.max_memory_allocated(0) / 1024**2

    # Toggle cold start flag
    if _is_cold_start:
        _is_cold_start = False

    # Log summary
    print(f"\n{'='*60}")
    print(f"Inference Job Complete: {run_id}")
    print(f"{'='*60}")
    print(f"Container: {'COLD START' if is_cold else 'WARM START'}")
    print(f"Total pairs: {metrics.total_frame_pairs}")
    print(f"Successful: {metrics.successful_inferences}")
    print(f"Failed: {metrics.failed_inferences}")
    print(f"Throughput: {metrics.pairs_per_second:.2f} pairs/sec")
    print(f"Avg time per pair: {metrics.avg_inference_time_ms:.2f} ms")
    print(f"Total job time: {metrics.total_job_duration_ms / 1000:.2f} sec")
    if metrics.peak_memory_mb:
        print(f"Peak GPU memory: {metrics.peak_memory_mb:.1f} MB")
    print(f"{'='*60}\n")

    return {
        "status": "success",
        "results": results,
        "metrics": metrics.to_dict(),
    }


@stub.local_entrypoint()
def main():
    """Test Modal deployment locally."""
    print("🚀 Testing Modal inference service...")

    # Test 1: Cold start
    print("\n[Test 1] Cold Start Test")
    result1 = test_inference.remote()

    print("\n✅ Test Results:")
    print(f"  Status: {result1['status']}")
    print(f"  Device: {result1['device']}")
    print(f"  GPU: {result1.get('gpu_name', 'N/A')}")
    print(f"  Memory: {result1.get('gpu_memory_gb', 'N/A')} GB")
    print(f"\n  Metrics:")
    print(f"    Cold start: {result1['metrics']['is_cold_start']}")
    print(f"    Init time: {result1['metrics']['initialization_ms']:.1f} ms")

    # Test 2: Warm start (within 5 min idle timeout)
    print("\n[Test 2] Warm Start Test (same container)")
    import time

    time.sleep(1)  # Brief pause
    result2 = test_inference.remote()

    print("\n✅ Test Results:")
    print(f"  Metrics:")
    print(f"    Cold start: {result2['metrics']['is_cold_start']}")
    print(f"    Container uptime: {result2['metrics']['container_uptime_s']:.1f} sec")
    print(f"    Init time: {result2['metrics']['initialization_ms']:.1f} ms")

    # Test 3: Batch inference with metrics
    print("\n[Test 3] Batch Inference Test")
    test_pairs = [(i, i + 1) for i in range(100)]  # 100 frame pairs

    result3 = run_boundary_inference_batch.remote(
        video_id="test-video",
        tenant_id="test-tenant",
        cropped_frames_version=1,
        model_version="test-model",
        run_id="test-run",
        frame_pairs=test_pairs,
    )

    print("\n✅ Batch Inference Results:")
    print(f"  Processed: {len(result3['results'])} pairs")
    print(f"  Metrics:")
    for key, value in result3["metrics"].items():
        if value is not None:
            if isinstance(value, float):
                print(f"    {key}: {value:.2f}")
            else:
                print(f"    {key}: {value}")

    if result1["gpu_available"]:
        print("\n🎉 GPU inference ready!")
    else:
        print("\n⚠️  No GPU detected (running on CPU)")

    print("\n💡 Usage Pattern Insights:")
    print(f"  - Cold start overhead: {result1['metrics']['initialization_ms']:.0f} ms")
    print(f"  - Warm start benefit: Container reuse within 5 min idle period")
    print(f"  - Current throughput: {result3['metrics']['pairs_per_second']:.1f} pairs/sec (placeholder)")
    print(f"  - Estimated time for 25k pairs: {25000 / result3['metrics']['pairs_per_second'] / 60:.1f} min (placeholder)")


if __name__ == "__main__":
    if modal is None:
        print("❌ Modal not installed. Install with: pip install modal")
        exit(1)

    main()
