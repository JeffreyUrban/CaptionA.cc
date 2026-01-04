#!/usr/bin/env python3
"""
Start Prefect worker to execute video processing flows.

This worker:
- Polls Prefect Cloud for flow runs to execute
- Limits concurrency to 2 simultaneous jobs (replaces processing-coordinator.ts)
- Runs as a long-lived process (survives web server restarts)

Usage:
    python start_worker.py
"""

import asyncio
import signal
import sys

from prefect.workers.process import ProcessWorker
from prefect.client.orchestration import get_client


# Global flag for graceful shutdown
shutdown_requested = False


def signal_handler(signum, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    global shutdown_requested
    print("\n\n⚠️  Shutdown signal received, finishing current jobs...")
    print("   (Press Ctrl+C again to force quit)")
    shutdown_requested = True


async def start_worker():
    """Start the Prefect worker with concurrency limit."""

    print("=" * 80)
    print("Starting CaptionA.cc Video Processing Worker")
    print("=" * 80)

    # Check Prefect connection
    try:
        async with get_client() as client:
            await client.hello()
            print("✅ Connected to Prefect Cloud successfully\n")
    except Exception as e:
        print(f"❌ Failed to connect to Prefect: {e}\n")
        print("Troubleshooting:")
        print("  1. Make sure you're logged in: prefect cloud login")
        print("  2. Check your internet connection")
        print("  3. Verify Prefect Cloud is accessible")
        sys.exit(1)

    # Configuration
    work_pool_name = "video-processing-pool"
    max_concurrent = 2  # Replaces MAX_TOTAL_CONCURRENT_PROCESSING from TypeScript

    print(f"Worker configuration:")
    print(f"  Work pool: {work_pool_name}")
    print(f"  Max concurrent jobs: {max_concurrent}")
    print(f"  Flow code location: {__file__}")
    print("=" * 80)
    print()

    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Create and start worker
    worker = ProcessWorker(
        name="video-processing-worker",
        work_pool_name=work_pool_name,
        limit=max_concurrent,  # Max 2 concurrent flow runs
    )

    print("🔄 Worker started, polling for flow runs...")
    print("   (Press Ctrl+C to stop gracefully)\n")

    try:
        await worker.start()
    except asyncio.CancelledError:
        print("\n✅ Worker stopped cleanly")
    except Exception as e:
        print(f"\n❌ Worker error: {e}")
        raise


if __name__ == "__main__":
    print("\nℹ️  This worker will run continuously until stopped.")
    print("   Logs from flow runs will appear below.\n")

    try:
        asyncio.run(start_worker())
    except KeyboardInterrupt:
        print("\n\n✅ Worker stopped by user")
    except Exception as e:
        print(f"\n❌ Worker failed: {e}")
        sys.exit(1)
