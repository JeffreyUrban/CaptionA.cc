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

# Import configuration for Modal limits
# See: data-pipelines/caption_boundaries/src/caption_boundaries/inference/config.py
from caption_boundaries.inference.config import MODAL_CONFIG


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


# Modal app
if modal:
    app = modal.App("boundary-inference")

    # GPU image with dependencies
    # Note: Frame extraction happens on GPU time - optimize this in future by:
    # - Pre-extracting frames before Modal call, OR
    # - Using GPU-accelerated image decoding (NVDEC)
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
            "sqlalchemy",
            "scikit-learn",
        )
        .apt_install("libgl1-mesa-glx", "libglib2.0-0")
        # Add local caption_boundaries package to the image
        .add_local_python_source("caption_boundaries")
    )

    # Model checkpoint volume (persistent across containers)
    model_volume = modal.Volume.from_name("boundary-models", create_if_missing=True)

    # Shared metrics tracking across container lifetime
    # Note: This persists across function calls within the same container
    _container_start_time = None
    _is_cold_start = True


@app.function(
    image=image,
    gpu="A10G",  # ~$1.10/hr
    volumes={"/models": model_volume},
    timeout=3600,  # 1 hour
    scaledown_window=300,  # 5 min warm period
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


@app.function(
    image=image,
    gpu=MODAL_CONFIG.gpu_type,
    volumes={"/models": model_volume},
    timeout=MODAL_CONFIG.timeout_seconds,  # Hard timeout (see config.py)
    scaledown_window=MODAL_CONFIG.container_idle_timeout_seconds,  # Idle shutdown (see config.py)
    max_containers=MODAL_CONFIG.concurrency_limit,  # Max parallel containers (see config.py)
    secrets=[
        modal.Secret.from_name("wasabi-credentials"),
        modal.Secret.from_name("supabase-credentials"),
    ],
)
def run_boundary_inference_batch(
    video_id: str,
    tenant_id: str,
    cropped_frames_version: int | None,
    model_version: str,
    run_id: str,
    frame_pairs: list[tuple[int, int]],
) -> dict:
    """Run inference on batch of frame pairs with detailed metrics.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        cropped_frames_version: Frame version number (None for unversioned paths)
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

    import tempfile

    from caption_boundaries.inference.batch_predictor import BatchBoundaryPredictor
    from caption_boundaries.inference.boundaries_db import PairResult, create_boundaries_db
    from caption_boundaries.inference.frame_extractor import (
        download_and_extract_chunks_parallel,
        get_frames_in_chunk,
    )

    # Use local WasabiClient copy - services.orchestrator is not available in Modal containers
    from caption_boundaries.inference.wasabi import WasabiClient

    print(f"\n{'=' * 60}")
    print(f"Starting Inference Job: {run_id}")
    print(f"{'=' * 60}")
    print(f"Video: {video_id}")
    print(f"Tenant: {tenant_id}")
    print(f"Frames version: {cropped_frames_version}")
    print(f"Model version: {model_version[:16]}...")
    print(f"Frame pairs: {len(frame_pairs)}")
    print(f"{'=' * 60}\n")

    # Initialize Wasabi client
    wasabi = WasabiClient()

    # Create temp directory for this job
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Step 1: Download layout.db
        print("[1/8] Downloading layout.db from Wasabi...")
        download_start = time.time()
        # Layout.db is stored alongside the video data (no extra "videos/" prefix)
        layout_storage_key = f"{tenant_id}/{video_id}/layout.db"
        layout_db_path = tmp_path / "layout.db"
        wasabi.download_file(layout_storage_key, layout_db_path)
        print(f"  Downloaded in {time.time() - download_start:.2f}s\n")

        # Step 2: Load model
        print("[2/8] Loading model checkpoint...")
        model_load_start = time.time()
        # Checkpoints are stored in /models/checkpoints/ subdirectory
        checkpoint_path = Path(f"/models/checkpoints/{model_version}.pt")
        if not checkpoint_path.exists():
            # Fallback to root /models/ for backwards compatibility
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

        # Step 3: List and download all chunks from all modulo levels
        # We process all sequential frame pairs, so we need all frames
        print("[3/8] Listing chunks from Wasabi...")
        discover_start = time.time()

        import re

        from PIL import Image as PILImage

        # chunk_info: dict mapping (chunk_start, modulo) -> (storage_key, list of frame indices)
        chunk_info: dict[tuple[int, int], tuple[str, list[int]]] = {}

        # List chunks for all three modulo levels
        for modulo in [16, 4, 1]:
            # Build prefix for this modulo directory
            sample_key = wasabi.build_chunk_storage_key(
                tenant_id=tenant_id,
                video_id=video_id,
                chunk_type="cropped_frames",
                chunk_index=0,
                version=cropped_frames_version,
                modulo=modulo,
            )
            dir_prefix = "/".join(sample_key.split("/")[:-1]) + "/"

            # List all chunks in this directory
            response = wasabi.s3_client.list_objects_v2(
                Bucket=wasabi.bucket_name,
                Prefix=dir_prefix,
            )

            if "Contents" not in response:
                print(f"  [WARNING] No chunks found for modulo_{modulo}")
                continue

            # Parse chunk filenames
            for obj in response["Contents"]:
                key = obj["Key"]
                match = re.search(r"chunk_(\d+)\.webm$", key)
                if match:
                    chunk_start = int(match.group(1))
                    frames_in_chunk = get_frames_in_chunk(chunk_start, modulo)
                    chunk_info[(chunk_start, modulo)] = (key, frames_in_chunk)

        print(f"  Found {len(chunk_info)} total chunks across all modulo levels")
        print(f"  Listing took {time.time() - discover_start:.2f}s\n")

        # Step 4: Download all chunks and extract all frames (parallel)
        print("[4/8] Downloading chunks and extracting frames (parallel)...")
        extract_start = time.time()

        # Build list of (signed_url, chunk_start, modulo) for parallel download
        chunk_download_list = []
        for (chunk_start, modulo), (storage_key, _) in chunk_info.items():
            signed_url = wasabi.generate_presigned_url(storage_key, expiration=3600)
            chunk_download_list.append((signed_url, chunk_start, modulo))

        print(f"  Downloading {len(chunk_download_list)} chunks in parallel...")

        # Download and extract all frames in parallel
        raw_frames = download_and_extract_chunks_parallel(chunk_download_list, max_workers=16)

        # Convert numpy arrays to PIL Images
        all_frames: dict[int, PILImage.Image] = {}
        for frame_idx, frame_array in raw_frames.items():
            all_frames[frame_idx] = PILImage.fromarray(frame_array)

        print(f"  Extracted {len(all_frames)} total frames in {time.time() - extract_start:.2f}s\n")

        # Step 5: Run GPU inference
        print("[5/8] Running GPU inference...")
        inference_start = time.time()

        # Split frame_pairs into batches for processing
        batch_size = MODAL_CONFIG.inference_batch_size
        num_batches = (len(frame_pairs) + batch_size - 1) // batch_size

        print(f"  Processing {len(frame_pairs)} pairs in {num_batches} batches (batch_size={batch_size})")

        # Results accumulators
        forward_predictions = []
        backward_predictions = []
        valid_indices = []

        for batch_idx in range(num_batches):
            batch_start = batch_idx * batch_size
            batch_end = min(batch_start + batch_size, len(frame_pairs))
            batch = frame_pairs[batch_start:batch_end]

            # Prepare bidirectional pairs for GPU
            bidirectional_pairs = []
            batch_valid_indices = []

            for local_idx, (frame1_idx, frame2_idx) in enumerate(batch):
                if frame1_idx in all_frames and frame2_idx in all_frames:
                    f1 = all_frames[frame1_idx]
                    f2 = all_frames[frame2_idx]
                    bidirectional_pairs.append((f1, f2))  # Forward
                    bidirectional_pairs.append((f2, f1))  # Backward
                    batch_valid_indices.append(batch_start + local_idx)
                else:
                    metrics.failed_inferences += 1

            # Run GPU inference on this batch
            if bidirectional_pairs:
                batch_predictions = predictor.predict_batch(bidirectional_pairs, batch_size=batch_size)

                # Split into forward/backward
                for i in range(len(batch_valid_indices)):
                    forward_predictions.append(batch_predictions[i * 2])
                    backward_predictions.append(batch_predictions[i * 2 + 1])
                valid_indices.extend(batch_valid_indices)

            # Progress update
            if (batch_idx + 1) % 10 == 0 or batch_idx + 1 == num_batches:
                elapsed = time.time() - inference_start
                pairs_done = len(valid_indices)
                rate = pairs_done / elapsed if elapsed > 0 else 0
                print(f"  Batch {batch_idx + 1}/{num_batches}: {pairs_done} pairs @ {rate:.1f} pairs/sec")

        inference_end = time.time()
        inference_time = inference_end - inference_start
        print(f"  Completed {len(valid_indices)} pairs in {inference_time:.2f}s")
        print(f"  Throughput: {len(valid_indices) / inference_time:.1f} pairs/sec\n")

        # Step 6: Create boundaries database
        print("[6/8] Creating boundaries database...")
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
        print("[7/8] Uploading boundaries database to Wasabi...")
        upload_start = time.time()

        # Build storage key for boundaries database
        from caption_boundaries.inference.boundaries_db import get_db_filename

        boundaries_filename = get_db_filename(cropped_frames_version, model_version, run_id)
        storage_key = f"videos/{tenant_id}/{video_id}/boundaries/{boundaries_filename}"

        wasabi.upload_file(db_path, storage_key, content_type="application/x-sqlite3")
        file_size_bytes = db_path.stat().st_size
        print(f"  Uploaded to {storage_key} in {time.time() - upload_start:.2f}s\n")

        # Step 8: Register run in Supabase
        print("[8/8] Registering inference run in Supabase...")
        register_start = time.time()

        try:
            from caption_boundaries.inference.inference_repository import BoundaryInferenceRunRepository

            # Initialize repository with environment credentials
            supabase_url = os.environ.get("SUPABASE_URL")
            supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

            if not supabase_url or not supabase_key:
                print("  [WARNING] Supabase credentials not set, skipping registration")
            else:
                repo = BoundaryInferenceRunRepository(supabase_url, supabase_key)

                # Register completed run
                repo.register_run(
                    run_id=run_id,
                    video_id=video_id,
                    tenant_id=tenant_id,
                    cropped_frames_version=cropped_frames_version,
                    model_version=model_version,
                    wasabi_storage_key=storage_key,
                    total_pairs=len(pair_results),
                    started_at=started_at,
                    completed_at=completed_at,
                    file_size_bytes=file_size_bytes,
                    processing_time_seconds=(completed_at - started_at).total_seconds(),
                    model_checkpoint_path=str(checkpoint_path),
                )

                print(f"  Registered in Supabase in {time.time() - register_start:.2f}s\n")
        except Exception as e:
            print(f"  [ERROR] Failed to register in Supabase: {e}")
            # Don't fail the job if Supabase registration fails

        # Return results with storage key
        results = {
            "storage_key": storage_key,
            "total_pairs": len(pair_results),
            "successful": metrics.successful_inferences,
            "failed": metrics.failed_inferences,
            "file_size_bytes": file_size_bytes,
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
    print(f"\n{'=' * 60}")
    print(f"Inference Job Complete: {run_id}")
    print(f"{'=' * 60}")
    print(f"Container: {'COLD START' if is_cold else 'WARM START'}")
    print(f"Total pairs: {metrics.total_frame_pairs}")
    print(f"Successful: {metrics.successful_inferences}")
    print(f"Failed: {metrics.failed_inferences}")
    if metrics.pairs_per_second is not None:
        print(f"Throughput: {metrics.pairs_per_second:.2f} pairs/sec")
    if metrics.avg_inference_time_ms is not None:
        print(f"Avg time per pair: {metrics.avg_inference_time_ms:.2f} ms")
    if metrics.total_job_duration_ms is not None:
        print(f"Total job time: {metrics.total_job_duration_ms / 1000:.2f} sec")
    if metrics.peak_memory_mb:
        print(f"Peak GPU memory: {metrics.peak_memory_mb:.1f} MB")
    print(f"{'=' * 60}\n")

    return {
        "status": "success",
        "results": results,
        "metrics": metrics.to_dict(),
    }


@app.local_entrypoint()
def main():
    """Test Modal deployment with real video data."""
    import uuid

    print("🚀 Testing Modal inference with real video data...")

    # Test video parameters
    VIDEO_ID = "50c16764-aa60-44bc-8a65-2a31e179897b"
    TENANT_ID = "dev/users/default_user/videos"
    MODEL_VERSION = "mrn0fkfd_a4b1a61c"
    RUN_ID = str(uuid.uuid4())

    # Test with 50 frame pairs (every 20th frame from 0-1000)
    frame_pairs = [(i, i + 1) for i in range(0, 1000, 20)]

    print("\nTest Configuration:")
    print(f"  Video ID: {VIDEO_ID}")
    print(f"  Tenant ID: {TENANT_ID}")
    print(f"  Model Version: {MODEL_VERSION}")
    print(f"  Run ID: {RUN_ID}")
    print(f"  Frame pairs: {len(frame_pairs)}")

    # Run inference
    print("\n[1/2] Running boundary inference...")
    result = run_boundary_inference_batch.remote(
        video_id=VIDEO_ID,
        tenant_id=TENANT_ID,
        cropped_frames_version=None,  # No version suffix in test data
        model_version=MODEL_VERSION,
        run_id=RUN_ID,
        frame_pairs=frame_pairs,
    )

    print("\n[2/2] Results:")
    print(f"  Status: {result['status']}")
    if result["status"] == "success":
        print(f"  Storage key: {result['results'].get('storage_key', 'N/A')}")
        print(f"  Total pairs: {result['results'].get('total_pairs', 'N/A')}")
        print(f"  Successful: {result['results'].get('successful', 'N/A')}")
        print(f"  Failed: {result['results'].get('failed', 'N/A')}")

        metrics = result.get("metrics", {})
        print("\n  Performance Metrics:")
        if metrics.get("total_job_ms"):
            print(f"    Total job time: {metrics['total_job_ms'] / 1000:.2f} sec")
        if metrics.get("pairs_per_second"):
            print(f"    Throughput: {metrics['pairs_per_second']:.1f} pairs/sec")
        if metrics.get("avg_inference_ms"):
            print(f"    Avg inference time: {metrics['avg_inference_ms']:.2f} ms/pair")
        if metrics.get("peak_memory_mb"):
            print(f"    Peak GPU memory: {metrics['peak_memory_mb']:.1f} MB")
    else:
        print(f"  Error: {result}")

    print("\n🎉 Test complete!")


if __name__ == "__main__":
    if modal is None:
        print("❌ Modal not installed. Install with: pip install modal")
        exit(1)

    main()
