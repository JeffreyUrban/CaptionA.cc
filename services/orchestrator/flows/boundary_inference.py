"""Boundary Inference Flow

Handles ML inference for caption boundary detection:
1. Check if inference run already exists (deduplication)
2. Generate frame pairs for video
3. Invoke Modal GPU inference function
4. Monitor job completion

Triggered after:
- Layout annotation approval → crop_frames → VP9 encoding completes
- On-demand: Admin requests inference with new model version
"""

import uuid
from typing import Any

from caption_boundaries.inference.config import MODAL_CONFIG, format_frame_count_limit_message
from prefect import flow, task
from prefect.artifacts import create_table_artifact
from services.orchestrator.monitoring.rejection_logger import log_rejection
from services.orchestrator.supabase_client import get_supabase_client


@task(
    name="check-existing-boundary-run",
    tags=["boundary-inference", "deduplication"],
    log_prints=True,
)
def check_existing_run(
    video_id: str,
    cropped_frames_version: int,
    model_version: str,
) -> dict[str, Any] | None:
    """Check if inference run already exists for this video + version + model.

    Args:
        video_id: Video UUID
        cropped_frames_version: Frame version number
        model_version: Model checkpoint hash

    Returns:
        Existing run dict if found, None otherwise
    """
    print("Checking for existing boundary inference run:")
    print(f"  Video: {video_id}")
    print(f"  Frames version: {cropped_frames_version}")
    print(f"  Model: {model_version[:16]}...")

    supabase = get_supabase_client()

    # Query boundary_inference_runs table
    response = (
        supabase.table("boundary_inference_runs")
        .select("*")
        .eq("video_id", video_id)
        .eq("cropped_frames_version", cropped_frames_version)
        .eq("model_version", model_version)
        .maybe_single()
        .execute()
    )

    if response.data:
        print(f"  ✓ Found existing run: {response.data['run_id']}")
        print(f"    Storage: {response.data['wasabi_storage_key']}")
        print(f"    Pairs: {response.data['total_pairs']}")
        return response.data
    else:
        print("  No existing run found - inference needed")
        return None


@task(
    name="generate-frame-pairs",
    tags=["boundary-inference"],
    log_prints=True,
)
def generate_frame_pairs(
    video_id: str,
    tenant_id: str,
    model_version: str | None = None,
    cropped_frames_version: int | None = None,
    priority: str | None = None,
) -> list[tuple[int, int]]:
    """Generate consecutive frame pairs for boundary detection.

    For a video with N frames at 10Hz:
    - Generate pairs: (0,1), (1,2), (2,3), ..., (N-2, N-1)
    - Typical video: 60 min × 600 frames/min = 36k frames → 35.9k pairs

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        model_version: Model version (for rejection logging)
        cropped_frames_version: Frame version (for rejection logging)
        priority: Job priority (for rejection logging)

    Returns:
        List of (frame1_index, frame2_index) tuples

    Raises:
        ValueError: If frame count exceeds configured limit
    """
    print(f"Generating frame pairs for video {video_id}")

    supabase = get_supabase_client()

    # Get frame count from video metadata
    response = supabase.table("videos").select("frame_count").eq("id", video_id).single().execute()

    if not response.data:
        raise ValueError(f"Video not found: {video_id}")

    frame_count = response.data.get("frame_count")
    if not frame_count:
        raise ValueError(f"Video {video_id} has no frame_count")

    # Validate frame count against configured limit
    # See: data-pipelines/caption_boundaries/src/caption_boundaries/inference/config.py
    if frame_count > MODAL_CONFIG.max_frame_count:
        # Log rejection for monitoring
        rejection_message = format_frame_count_limit_message(frame_count, MODAL_CONFIG)
        log_rejection(
            video_id=video_id,
            tenant_id=tenant_id,
            rejection_type="frame_count_exceeded",
            rejection_message=rejection_message,
            frame_count=frame_count,
            cropped_frames_version=cropped_frames_version,
            model_version=model_version,
            priority=priority,
        )
        raise ValueError(rejection_message)

    # Warning for videos approaching the limit
    if frame_count > MODAL_CONFIG.frame_count_warning_threshold:
        print(
            f"⚠️  WARNING: Frame count {frame_count:,} is close to limit ({MODAL_CONFIG.max_frame_count:,})"
        )
        print("   Consider reviewing inference/config.py if this is expected.")

    # Generate consecutive pairs
    pairs = [(i, i + 1) for i in range(frame_count - 1)]

    print(f"  Generated {len(pairs)} frame pairs (0..{frame_count - 2})")

    return pairs


@task(
    name="invoke-modal-inference",
    retries=2,
    retry_delay_seconds=300,  # 5 min retry delay
    tags=["boundary-inference", "modal", "gpu"],
    log_prints=True,
)
def invoke_modal_inference(
    video_id: str,
    tenant_id: str,
    cropped_frames_version: int,
    model_version: str,
    run_id: str,
    frame_pairs: list[tuple[int, int]],
) -> dict[str, Any]:
    """Invoke Modal GPU inference function.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        cropped_frames_version: Frame version number
        model_version: Model checkpoint hash
        run_id: Inference run UUID
        frame_pairs: List of (frame1_index, frame2_index) tuples

    Returns:
        Inference results with storage_key and metrics
    """
    print("Invoking Modal inference function:")
    print(f"  Run ID: {run_id}")
    print(f"  Video: {video_id}")
    print(f"  Frame pairs: {len(frame_pairs)}")
    print(f"  Model: {model_version[:16]}...")

    try:
        # Import Modal function
        # Note: This requires Modal to be installed and configured
        from caption_boundaries.inference.service import run_boundary_inference_batch

        # Call Modal function (blocks until complete)
        result = run_boundary_inference_batch.remote(
            video_id=video_id,
            tenant_id=tenant_id,
            cropped_frames_version=cropped_frames_version,
            model_version=model_version,
            run_id=run_id,
            frame_pairs=frame_pairs,
        )

        print("\n✓ Modal inference complete:")
        print(f"  Storage key: {result['results']['storage_key']}")
        print(f"  Successful: {result['results']['successful']}/{result['results']['total_pairs']}")
        print(f"  Failed: {result['results']['failed']}")
        print(f"  Throughput: {result['metrics']['pairs_per_second']:.1f} pairs/sec")
        print(f"  Total time: {result['metrics']['total_job_ms'] / 1000:.1f}s")

        return result

    except Exception as e:
        print(f"✗ Modal inference failed: {e}")
        raise


@flow(
    name="boundary-inference",
    description="Run ML inference for caption boundary detection",
    log_prints=True,
)
def boundary_inference_flow(
    video_id: str,
    tenant_id: str,
    cropped_frames_version: int,
    model_version: str,
    priority: str = "high",
    skip_if_exists: bool = True,
) -> dict[str, Any]:
    """Run boundary inference for a video.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        cropped_frames_version: Frame version number
        model_version: Model checkpoint hash (SHA256)
        priority: Job priority ('high' or 'low')
        skip_if_exists: Skip if run already exists (deduplication)

    Returns:
        Dict with status and inference results
    """
    print("\n" + "=" * 60)
    print("BOUNDARY INFERENCE FLOW")
    print("=" * 60)
    print(f"Video: {video_id}")
    print(f"Tenant: {tenant_id}")
    print(f"Frames version: {cropped_frames_version}")
    print(f"Model: {model_version[:16]}...")
    print(f"Priority: {priority}")
    print("=" * 60 + "\n")

    # Step 1: Check for existing run (deduplication)
    existing_run = check_existing_run(video_id, cropped_frames_version, model_version)

    if existing_run and skip_if_exists:
        print("\n✓ Inference run already exists - skipping")
        return {
            "status": "skipped",
            "reason": "run_already_exists",
            "existing_run_id": existing_run["run_id"],
            "storage_key": existing_run["wasabi_storage_key"],
        }

    # Step 2: Generate frame pairs (with rejection logging)
    frame_pairs = generate_frame_pairs(
        video_id=video_id,
        tenant_id=tenant_id,
        model_version=model_version,
        cropped_frames_version=cropped_frames_version,
        priority=priority,
    )

    # Step 2.5: Estimate cost (transparency + validation)
    from caption_boundaries.inference.config import estimate_job_cost

    # Add 1 back to get frame count from pairs count
    cost_estimate = estimate_job_cost(len(frame_pairs) + 1, MODAL_CONFIG)

    print("\n💰 Cost Estimate:")
    print(f"  Frame pairs: {cost_estimate['frame_pairs']:,}")
    print(
        f"  Estimated time: {cost_estimate['estimated_seconds']:.0f}s ({cost_estimate['estimated_seconds'] / 60:.1f} min)"
    )
    print(f"  Estimated cost: ${cost_estimate['estimated_cost_usd']:.4f}")

    # Safety check: reject if too expensive
    # See: data-pipelines/caption_boundaries/src/caption_boundaries/inference/config.py
    if cost_estimate["estimated_cost_usd"] > MODAL_CONFIG.max_cost_per_job_usd:
        rejection_message = (
            f"Job too expensive: ${cost_estimate['estimated_cost_usd']:.2f} "
            f"(threshold: ${MODAL_CONFIG.max_cost_per_job_usd:.2f}). "
            f"Frame pairs: {len(frame_pairs):,}\n"
            f"\n"
            f"To process this job, increase max_cost_per_job_usd in:\n"
            f"data-pipelines/caption_boundaries/src/caption_boundaries/inference/config.py"
        )

        # Log rejection for monitoring
        log_rejection(
            video_id=video_id,
            tenant_id=tenant_id,
            rejection_type="cost_exceeded",
            rejection_message=rejection_message,
            frame_count=len(frame_pairs) + 1,
            estimated_cost_usd=cost_estimate["estimated_cost_usd"],
            cropped_frames_version=cropped_frames_version,
            model_version=model_version,
            priority=priority,
        )

        raise ValueError(rejection_message)

    # Step 3: Generate unique run ID
    run_id = str(uuid.uuid4())

    # Step 4: Invoke Modal inference
    result = invoke_modal_inference(
        video_id=video_id,
        tenant_id=tenant_id,
        cropped_frames_version=cropped_frames_version,
        model_version=model_version,
        run_id=run_id,
        frame_pairs=frame_pairs,
    )

    # Step 5: Create summary artifact
    create_table_artifact(
        key="boundary-inference-summary",
        table={
            "Run ID": [run_id],
            "Video ID": [video_id],
            "Model": [model_version[:16]],
            "Total Pairs": [result["results"]["total_pairs"]],
            "Successful": [result["results"]["successful"]],
            "Failed": [result["results"]["failed"]],
            "Storage Key": [result["results"]["storage_key"]],
            "Throughput (pairs/sec)": [f"{result['metrics']['pairs_per_second']:.1f}"],
            "Total Time (sec)": [f"{result['metrics']['total_job_ms'] / 1000:.1f}"],
        },
        description=f"Boundary inference completed for video {video_id}",
    )

    print("\n" + "=" * 60)
    print("FLOW COMPLETE")
    print("=" * 60)
    print(f"✓ Inference run: {run_id}")
    print(f"✓ Storage: {result['results']['storage_key']}")
    print(f"✓ Results: {result['results']['successful']} pairs processed")
    print("=" * 60 + "\n")

    return {
        "status": "success",
        "run_id": run_id,
        "storage_key": result["results"]["storage_key"],
        "total_pairs": result["results"]["total_pairs"],
        "successful": result["results"]["successful"],
        "failed": result["results"]["failed"],
        "metrics": result["metrics"],
    }


# Convenience function for on-demand inference
def run_inference_for_video(
    video_id: str,
    model_version: str,
    priority: str = "low",
) -> dict[str, Any]:
    """Run inference for a video (convenience wrapper).

    Fetches video metadata and calls flow.

    Args:
        video_id: Video UUID
        model_version: Model checkpoint hash
        priority: Job priority ('high' or 'low')

    Returns:
        Flow result dict
    """
    supabase = get_supabase_client()

    # Get video metadata
    response = (
        supabase.table("videos")
        .select("tenant_id, cropped_frames_version")
        .eq("id", video_id)
        .single()
        .execute()
    )

    if not response.data:
        raise ValueError(f"Video not found: {video_id}")

    tenant_id = response.data["tenant_id"]
    cropped_frames_version = response.data["cropped_frames_version"]

    # Run flow
    return boundary_inference_flow(
        video_id=video_id,
        tenant_id=tenant_id,
        cropped_frames_version=cropped_frames_version,
        model_version=model_version,
        priority=priority,
    )
