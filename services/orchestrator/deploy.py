#!/usr/bin/env python3
"""
Deploy Prefect flows to Prefect Server (ephemeral or cloud).

This script deploys all video processing flows.

Usage:
    python deploy.py
"""

from flows.video_processing import process_video_initial_flow


def deploy_flows():
    """Deploy all flows."""

    print("=" * 80)
    print("Deploying CaptionA.cc video processing flows")
    print("=" * 80)
    print()

    # Deploy background full frames processing
    print("📦 Deploying: process-video-initial")
    process_video_initial_flow.serve(
        name="process-video-initial-deployment",
        tags=["background", "full-frames", "ocr", "low-priority"],
        description="Initial video processing: frame extraction at 0.1Hz + OCR",
        version="1.0.0",
        pause_on_shutdown=False,
        print_starting_message=True,
    )


if __name__ == "__main__":
    print("\nℹ️  Starting deployment server...")
    print("   This will run continuously and serve your flows.")
    print("   Press Ctrl+C to stop.\n")

    try:
        deploy_flows()
    except KeyboardInterrupt:
        print("\n\n✅ Deployment server stopped")
    except Exception as e:
        print(f"\n❌ Deployment failed: {e}")
        raise
