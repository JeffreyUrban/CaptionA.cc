#!/usr/bin/env python3
"""
Start both the Health API and Prefect Worker together.

This is the main entry point for the orchestrator service on Fly.io.
It runs:
1. FastAPI health check server on port 8000
2. Prefect worker for flow execution

Usage:
    python start_all.py
"""

import asyncio
import multiprocessing
import signal
import sys
import time

import uvicorn
from prefect.client.orchestration import get_client
from prefect.workers.process import ProcessWorker


def run_health_api():
    """Run the health check API server."""
    print("🏥 Starting Health API on port 8000...")

    # Import here to avoid issues with multiprocessing
    from api.main import app

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=False,  # Reduce log noise from health checks
    )


async def run_prefect_worker():
    """Run the Prefect worker."""
    print("=" * 80)
    print("Starting CaptionA.cc Prefect Worker")
    print("=" * 80)

    # Check Prefect connection (optional - only for Prefect Cloud)
    # In ephemeral mode, this check is skipped
    if os.getenv("PREFECT_API_URL"):
        try:
            async with get_client() as client:
                await client.hello()
                print("✅ Connected to Prefect Cloud successfully\n")
        except Exception as e:
            print(f"⚠️  Warning: Failed to connect to Prefect Cloud: {e}")
            print("Continuing in ephemeral mode...\n")
    else:
        print("✅ Running in ephemeral mode (no Prefect Cloud connection)\n")

    # Configuration
    work_pool_name = "video-processing-pool"
    max_concurrent = 2

    print("Worker configuration:")
    print(f"  Work pool: {work_pool_name}")
    print(f"  Max concurrent jobs: {max_concurrent}")
    print("=" * 80)
    print()

    # Create and start worker
    worker = ProcessWorker(
        name="video-processing-worker",
        work_pool_name=work_pool_name,
        limit=max_concurrent,
    )

    print("🔄 Worker started, polling for flow runs...")
    print("=" * 80)
    print()

    try:
        await worker.start()
    except asyncio.CancelledError:
        print("\n✅ Worker stopped cleanly")
    except Exception as e:
        print(f"\n❌ Worker error: {e}")
        raise


def run_worker_process():
    """Entry point for worker subprocess."""
    try:
        asyncio.run(run_prefect_worker())
    except KeyboardInterrupt:
        print("\n✅ Worker stopped by user")
    except Exception as e:
        print(f"\n❌ Worker failed: {e}")
        sys.exit(1)


def main():
    """Start both services."""
    print("=" * 80)
    print("CaptionA.cc Orchestrator Service")
    print("=" * 80)
    print()
    print("Starting:")
    print("  1. Health API (port 8000)")
    print("  2. Prefect Worker (video processing)")
    print()
    print("Press Ctrl+C to stop both services")
    print("=" * 80)
    print()

    # Start health API in a separate process
    api_process = multiprocessing.Process(target=run_health_api, name="health-api")
    api_process.start()

    # Give API time to start
    time.sleep(2)

    # Start worker in a separate process
    worker_process = multiprocessing.Process(target=run_worker_process, name="prefect-worker")
    worker_process.start()

    # Handle graceful shutdown
    def signal_handler(signum, frame):
        print("\n\n⚠️  Shutdown signal received, stopping services...")
        api_process.terminate()
        worker_process.terminate()

        # Wait for processes to stop (with timeout)
        api_process.join(timeout=5)
        worker_process.join(timeout=5)

        # Force kill if still running
        if api_process.is_alive():
            api_process.kill()
        if worker_process.is_alive():
            worker_process.kill()

        print("✅ All services stopped")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Monitor processes
    try:
        while True:
            time.sleep(1)

            # Restart crashed processes
            if not api_process.is_alive():
                print("⚠️  Health API crashed, restarting...")
                api_process = multiprocessing.Process(target=run_health_api, name="health-api")
                api_process.start()

            if not worker_process.is_alive():
                print("⚠️  Worker crashed, restarting...")
                worker_process = multiprocessing.Process(
                    target=run_worker_process, name="prefect-worker"
                )
                worker_process.start()

    except KeyboardInterrupt:
        signal_handler(signal.SIGINT, None)


if __name__ == "__main__":
    # Required for Windows
    multiprocessing.set_start_method("spawn", force=True)

    try:
        main()
    except Exception as e:
        print(f"\n❌ Service failed: {e}")
        sys.exit(1)
