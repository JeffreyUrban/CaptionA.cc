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
            "boto3",
            "pillow",
            "supabase",
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

    # Real implementation
    import tempfile
    from collections import defaultdict

    import torch
    from caption_boundaries.inference.batch_predictor import BatchBoundaryPredictor
    from caption_boundaries.inference.boundaries_db import PairResult, compute_model_version_hash, create_boundaries_db
    from caption_boundaries.inference.frame_extractor import extract_frame_from_chunk
    from caption_boundaries.inference.wasabi_storage import WasabiStorage

    print(f"\n{'='*60}")
    print(f"Starting Inference Job: {run_id}")
    print(f"{'='*60}")
    print(f"Video: {video_id}")
    print(f"Tenant: {tenant_id}")
    print(f"Frames version: {cropped_frames_version}")
    print(f"Model version: {model_version[:16]}...")
    print(f"Frame pairs: {len(frame_pairs)}")
    print(f"{'='*60}\n")

    # Initialize Wasabi storage
    storage = WasabiStorage()

    # Create temp directory for this job
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Step 1: Download layout.db
        print("[1/7] Downloading layout.db from Wasabi...")
        download_start = time.time()
        layout_db_path = storage.download_layout_db(tenant_id, video_id, tmp_path)
        print(f"  Downloaded in {time.time() - download_start:.2f}s\n")

        # Step 2: Load model
        print(f"[2/7] Loading model checkpoint...")
        model_load_start = time.time()
        checkpoint_path = Path(f"/models/{model_version}.pt")
        if not checkpoint_path.exists():
            raise FileNotFoundError(f"Model checkpoint not found: {checkpoint_path}")

        predictor = BatchBoundaryPredictor(
            checkpoint_path=checkpoint_path,
            layout_db_path=layout_db_path,
            device="cuda" if torch.cuda.is_available() else "cpu",
        )
        metrics.model_load_duration_ms = (time.time() - model_load_start) * 1000
        print(f"  Loaded in {metrics.model_load_duration_ms:.0f}ms\n")

        # Step 3: Determine needed chunks and generate signed URLs
        print("[3/7] Generating signed URLs for VP9 chunks...")
        url_start = time.time()

        # Group frame indices by chunk
        needed_chunks: dict[tuple[int, int], set[int]] = defaultdict(set)
        for frame1_idx, frame2_idx in frame_pairs:
            for frame_idx in [frame1_idx, frame2_idx]:
                # Determine modulo level
                if frame_idx % 16 == 0:
                    modulo = 16
                elif frame_idx % 4 == 0:
                    modulo = 4
                else:
                    modulo = 1

                # Calculate chunk index
                chunk_size = 32 * modulo
                chunk_index = (frame_idx // chunk_size) * modulo
                needed_chunks[(chunk_index, modulo)].add(frame_idx)

        # Generate signed URLs
        chunk_indices = [chunk_idx for chunk_idx, _ in needed_chunks.keys()]
        modulos = [modulo for _, modulo in needed_chunks.keys()]

        signed_urls = storage.generate_chunk_signed_urls(
            tenant_id=tenant_id,
            video_id=video_id,
            cropped_frames_version=cropped_frames_version,
            chunk_indices=chunk_indices,
            modulos=modulos,
            expiration=3600,
        )
        print(f"  Generated {len(signed_urls)} signed URLs in {time.time() - url_start:.2f}s\n")

        # Step 4: Extract frames
        print("[4/7] Extracting frames from VP9 chunks...")
        extract_start = time.time()

        # Extract unique frame indices
        unique_frames = set()
        for frame1_idx, frame2_idx in frame_pairs:
            unique_frames.add(frame1_idx)
            unique_frames.add(frame2_idx)

        extracted_frames = {}
        for frame_idx in sorted(unique_frames):
            # Determine chunk
            if frame_idx % 16 == 0:
                modulo = 16
            elif frame_idx % 4 == 0:
                modulo = 4
            else:
                modulo = 1

            chunk_size = 32 * modulo
            chunk_index = (frame_idx // chunk_size) * modulo

            if chunk_index not in signed_urls:
                print(f"  [WARNING] Missing signed URL for chunk {chunk_index}, skipping frame {frame_idx}")
                metrics.failed_inferences += 1
                continue

            try:
                frame = extract_frame_from_chunk(
                    signed_url=signed_urls[chunk_index],
                    frame_index=frame_idx,
                    modulo=modulo,
                )
                # Convert to PIL
                from PIL import Image as PILImage

                extracted_frames[frame_idx] = PILImage.fromarray(frame)
            except Exception as e:
                print(f"  [ERROR] Failed to extract frame {frame_idx}: {e}")
                metrics.failed_inferences += 1

        print(f"  Extracted {len(extracted_frames)} frames in {time.time() - extract_start:.2f}s\n")

        # Step 5: Run inference
        print("[5/7] Running batch inference...")
        inference_start = time.time()

        # Prepare frame pairs for batch prediction
        valid_pairs = []
        valid_indices = []
        for i, (frame1_idx, frame2_idx) in enumerate(frame_pairs):
            if frame1_idx in extracted_frames and frame2_idx in extracted_frames:
                valid_pairs.append((extracted_frames[frame1_idx], extracted_frames[frame2_idx]))
                valid_indices.append(i)
            else:
                metrics.failed_inferences += 1

        # Run batch prediction
        forward_predictions = predictor.predict_batch(valid_pairs, batch_size=32)

        # For backward, swap frame order
        backward_pairs = [(f2, f1) for f1, f2 in valid_pairs]
        backward_predictions = predictor.predict_batch(backward_pairs, batch_size=32)

        inference_end = time.time()
        print(f"  Completed in {inference_end - inference_start:.2f}s\n")

        # Step 6: Create boundaries database
        print("[6/7] Creating boundaries database...")
        db_start = time.time()

        pair_results = []
        for i, orig_idx in enumerate(valid_indices):
            frame1_idx, frame2_idx = frame_pairs[orig_idx]
            forward_pred = forward_predictions[i]
            backward_pred = backward_predictions[i]

            pair_result = PairResult(
                frame1_index=frame1_idx,
                frame2_index=frame2_idx,
                forward_predicted_label=forward_pred["predicted_label"],
                forward_confidence=forward_pred["confidence"],
                forward_prob_same=forward_pred["probabilities"]["same"],
                forward_prob_different=forward_pred["probabilities"]["different"],
                forward_prob_empty_empty=forward_pred["probabilities"]["empty_empty"],
                forward_prob_empty_valid=forward_pred["probabilities"]["empty_valid"],
                forward_prob_valid_empty=forward_pred["probabilities"]["valid_empty"],
                backward_predicted_label=backward_pred["predicted_label"],
                backward_confidence=backward_pred["confidence"],
                backward_prob_same=backward_pred["probabilities"]["same"],
                backward_prob_different=backward_pred["probabilities"]["different"],
                backward_prob_empty_empty=backward_pred["probabilities"]["empty_empty"],
                backward_prob_empty_valid=backward_pred["probabilities"]["empty_valid"],
                backward_prob_valid_empty=backward_pred["probabilities"]["valid_empty"],
                processing_time_ms=None,
            )
            pair_results.append(pair_result)

        metrics.successful_inferences = len(pair_results)

        # Create database
        from caption_boundaries.inference.boundaries_db import get_db_filename

        db_filename = get_db_filename(cropped_frames_version, model_version, run_id)
        db_path = tmp_path / db_filename

        started_at = datetime.fromtimestamp(job_start)
        completed_at = datetime.now()

        create_boundaries_db(
            db_path=db_path,
            cropped_frames_version=cropped_frames_version,
            model_version=model_version,
            run_id=run_id,
            started_at=started_at,
            completed_at=completed_at,
            results=pair_results,
            model_checkpoint_path=str(checkpoint_path),
        )
        print(f"  Created database in {time.time() - db_start:.2f}s\n")

        # Step 7: Upload boundaries database to Wasabi
        print("[7/7] Uploading boundaries database to Wasabi...")
        upload_start = time.time()
        storage_key = storage.upload_boundaries_db(
            local_path=db_path,
            tenant_id=tenant_id,
            video_id=video_id,
            boundaries_version=cropped_frames_version,
            model_version=model_version,
            run_id=run_id,
        )
        print(f"  Uploaded in {time.time() - upload_start:.2f}s\n")

        # Return results with storage key
        results = {
            "storage_key": storage_key,
            "total_pairs": len(pair_results),
            "successful": metrics.successful_inferences,
            "failed": metrics.failed_inferences,
        }

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
