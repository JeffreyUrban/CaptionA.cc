"""Configuration for Modal GPU inference service.

IMPORTANT: This file contains cost and safety limits for serverless GPU inference.
Review these settings carefully before modifying.
"""

from dataclasses import dataclass


@dataclass
class ModalInferenceConfig:
    """Configuration for Modal GPU inference service.

    These settings control cost, performance, and safety limits for boundary
    inference running on Modal's serverless GPU infrastructure.

    CRITICAL SETTINGS - Review before changing:
    - max_frame_count: Hard limit on video length (cost control)
    - concurrency_limit: Max parallel GPU containers
    - max_cost_per_job_usd: Reject jobs exceeding this cost
    """

    # ============================================================================
    # FRAME COUNT LIMITS (COST CONTROL)
    # ============================================================================

    # Maximum frame count per video
    #
    # Current: 200,000 frames = ~5.5 hour video at 10Hz
    #
    # Why this limit exists:
    # - Prevents accidentally processing extremely long videos
    # - Cost safety: 200k frames = ~$0.55 per video
    # - Processing time: ~33 minutes on A10G GPU
    #
    # When to increase:
    # - Supporting longer videos (2-3 hour content)
    # - Increase gradually: 300k → 500k → 1M
    # - Monitor costs closely when changing
    #
    # Cost calculator:
    # - Frame pairs = frame_count - 1
    # - Processing time = pairs / 100 pairs/sec
    # - Cost = (time / 3600) * $1.10/hr
    # - Example: 200k frames = 199,999 pairs = 2000s = $0.61
    max_frame_count: int = 200_000

    # Warning threshold (log but don't reject)
    # Set to 90% of max_frame_count by default
    frame_count_warning_threshold: int = 180_000

    # ============================================================================
    # GPU CONFIGURATION
    # ============================================================================

    # GPU type (Modal naming)
    gpu_type: str = "A10G"

    # GPU hourly cost (for cost estimation)
    gpu_cost_per_hour_usd: float = 1.10

    # Expected throughput (pairs per second)
    expected_throughput_pairs_per_sec: float = 100.0

    # ============================================================================
    # CONCURRENCY & QUEUE LIMITS (COST CEILING)
    # ============================================================================

    # Maximum number of parallel GPU containers
    # Current: 5 containers = $5.50/hr max concurrent cost
    #
    # Increase carefully - each container costs $1.10/hr while running
    concurrency_limit: int = 5

    # Maximum queued jobs (prevents unbounded queue growth)
    allow_concurrent_inputs: int = 50

    # ============================================================================
    # TIMEOUT CONFIGURATION (HUNG PROCESS PROTECTION)
    # ============================================================================

    # Hard timeout (seconds) - unconditional kill
    # Current: 1 hour = 10-15x expected processing time for 200k frames
    # Protects against: infinite loops, stuck processes
    timeout_seconds: int = 3600

    # Idle timeout (seconds) - kill if no CPU activity
    # Current: 5 minutes
    # Protects against: deadlocks, network hangs, I/O waits
    container_idle_timeout_seconds: int = 300

    # ============================================================================
    # COST VALIDATION
    # ============================================================================

    # Maximum cost per job (USD)
    # Jobs exceeding this cost are rejected
    # Current: $1.00 = ~91 minutes = ~550k frame pairs (edge case)
    max_cost_per_job_usd: float = 1.00

    # ============================================================================
    # RETRY CONFIGURATION
    # ============================================================================

    # Maximum retry attempts for failed jobs
    max_retries: int = 2

    # Delay between retries (seconds)
    retry_delay_seconds: int = 300  # 5 minutes

    # ============================================================================
    # BATCH SIZE
    # ============================================================================

    # Inference batch size (bidirectional pairs processed together)
    # Current: 64 pairs = 128 images per batch (32 forward + 32 backward)
    #
    # A10G GPU memory: 24GB VRAM
    # - Typical usage: ~8GB for model + ~2-4GB for batch
    # - Batch size 64 is safe with headroom
    #
    # Increase carefully - monitor GPU memory usage
    inference_batch_size: int = 64

    # ============================================================================
    # CACHE CONFIGURATION
    # ============================================================================

    # LRU cache size for VP9 chunks (used for A/B testing model versions)
    # Each chunk: ~2MB compressed
    # Cache size 100 = ~200MB memory
    chunk_cache_size: int = 100


# Default configuration instance
# Import this in application code: `from caption_boundaries.inference.config import MODAL_CONFIG`
MODAL_CONFIG = ModalInferenceConfig()


# ============================================================================
# COST ESTIMATION HELPERS
# ============================================================================


def estimate_job_cost(frame_count: int, config: ModalInferenceConfig = MODAL_CONFIG) -> dict[str, float]:
    """Estimate cost and time for a video with given frame count.

    Args:
        frame_count: Number of frames in video
        config: Configuration to use for estimation

    Returns:
        Dict with estimated_seconds, estimated_hours, estimated_cost_usd
    """
    frame_pairs = frame_count - 1
    estimated_seconds = frame_pairs / config.expected_throughput_pairs_per_sec
    estimated_hours = estimated_seconds / 3600
    estimated_cost_usd = estimated_hours * config.gpu_cost_per_hour_usd

    return {
        "frame_pairs": frame_pairs,
        "estimated_seconds": estimated_seconds,
        "estimated_hours": estimated_hours,
        "estimated_cost_usd": estimated_cost_usd,
    }


def format_frame_count_limit_message(
    frame_count: int,
    config: ModalInferenceConfig = MODAL_CONFIG,
) -> str:
    """Format clear error message when frame count exceeds limit.

    Args:
        frame_count: Actual frame count that was rejected
        config: Configuration containing the limit

    Returns:
        Formatted error message with actionable guidance
    """
    estimate = estimate_job_cost(frame_count, config)

    return (
        f"❌ Frame count too high: {frame_count:,} frames (limit: {config.max_frame_count:,})\n"
        f"\n"
        f"This video would cost ~${estimate['estimated_cost_usd']:.2f} "
        f"and take ~{estimate['estimated_seconds'] / 60:.0f} minutes to process.\n"
        f"\n"
        f"To process this video:\n"
        f"1. Review cost implications above\n"
        f"2. Increase limit in: data-pipelines/caption_boundaries/src/caption_boundaries/inference/config.py\n"
        f"3. Update MODAL_CONFIG.max_frame_count (currently {config.max_frame_count:,})\n"
        f"4. Consider increasing max_cost_per_job_usd if needed (currently ${config.max_cost_per_job_usd:.2f})\n"
        f"\n"
        f"⚠️  WARNING: Increasing limits will increase monthly costs. Monitor spending carefully."
    )
