#!/usr/bin/env python3
"""
Serve Prefect flows (makes them available for execution).

This runs a deployment server that makes flows available to workers.
In ephemeral mode, this is required to make flows executable.

Usage:
    python serve_flows.py
"""

from prefect import serve

from flows.video_processing import process_video_initial_flow
from flows.crop_frames import crop_frames_flow


if __name__ == "__main__":
    print("=" * 80)
    print("Starting Prefect Flow Server")
    print("=" * 80)
    print()
    print("This makes your flows available for execution.")
    print("Keep this running in a terminal.")
    print()
    print("Serving flows:")
    print("  - process-video-initial (background processing)")
    print("  - crop-video-frames (user-initiated)")
    print()
    print("Press Ctrl+C to stop")
    print("=" * 80)
    print()

    # Serve both flows
    serve(
        process_video_initial_flow.to_deployment(
            name="production",
            tags=["background", "full-frames"],
        ),
        crop_frames_flow.to_deployment(
            name="production",
            tags=["user-initiated", "crop-frames"],
        ),
    )
