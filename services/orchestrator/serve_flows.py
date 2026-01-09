#!/usr/bin/env python3
"""
Serve Prefect flows (makes them available for execution).

This runs a deployment server that makes flows available to workers.
In ephemeral mode, this is required to make flows executable.

Usage:
    python serve_flows.py
"""

import sys
from pathlib import Path

# Load environment variables from monorepo root
from dotenv import load_dotenv

monorepo_root = Path(__file__).parent.parent.parent
env_path = monorepo_root / ".env"
if env_path.exists():
    load_dotenv(env_path)
    print(f"✓ Loaded environment from {env_path}")
else:
    print(f"⚠ No .env file found at {env_path}")

# Add orchestrator directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from prefect import serve

from flows.base_model_update import base_model_update_flow
from flows.caption_annotation import (
    download_for_caption_annotation_flow,
    upload_captions_db_flow,
)
from flows.caption_median_ocr import caption_median_ocr_flow
from flows.crop_frames import crop_frames_flow
from flows.crop_frames_to_webm import crop_frames_to_webm_flow
from flows.layout_annotation import download_for_layout_annotation_flow, upload_layout_db_flow
from flows.upload_and_process_video import upload_and_process_video_flow
from flows.video_model_retrain import retrain_video_model_flow
from flows.video_processing import process_video_initial_flow

if __name__ == "__main__":
    print("=" * 80)
    print("Starting Prefect Flow Server")
    print("=" * 80)
    print()
    print("This makes your flows available for execution.")
    print("Keep this running in a terminal.")
    print()
    print("Serving flows:")
    print("  - upload-and-process-video (Wasabi upload pipeline)")
    print("  - download-for-layout-annotation (Wasabi download)")
    print("  - upload-layout-db (Wasabi upload)")
    print("  - crop-frames-to-webm (cropped frames processing)")
    print("  - download-for-caption-annotation (Wasabi download)")
    print("  - upload-captions-db (Wasabi upload)")
    print("  - process-video-initial (background processing)")
    print("  - crop-video-frames (user-initiated)")
    print("  - process-caption-median-ocr (user-initiated)")
    print("  - update-base-model-globally (admin/maintenance)")
    print("  - retrain-video-model (user-initiated/batch)")
    print()
    print("Press Ctrl+C to stop")
    print("=" * 80)
    print()

    # Serve all flows
    # Prefect type stubs incorrectly type to_deployment() as returning RunnerDeployment | Coroutine
    # In reality, it returns RunnerDeployment directly (not async)
    serve(
        # Wasabi-based upload and processing workflow
        upload_and_process_video_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["upload", "processing", "high-priority"],
        ),
        # Wasabi-based layout annotation workflows
        download_for_layout_annotation_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["download", "layout-annotation", "user-initiated"],
        ),
        upload_layout_db_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["upload", "layout-annotation", "user-initiated", "high-priority"],
        ),
        # Wasabi-based cropped frames WebM generation
        crop_frames_to_webm_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["crop-frames", "webm", "user-initiated", "high-priority"],
        ),
        # Wasabi-based caption annotation workflows
        download_for_caption_annotation_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["download", "caption-annotation", "user-initiated"],
        ),
        upload_captions_db_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["upload", "caption-annotation", "user-initiated", "high-priority"],
        ),
        # Legacy local processing workflows (will be deprecated)
        process_video_initial_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["background", "full-frames"],
        ),
        crop_frames_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["user-initiated", "crop-frames"],
        ),
        caption_median_ocr_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["user-initiated", "median-ocr"],
        ),
        # Model training workflows
        base_model_update_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["admin", "base-model"],
        ),
        retrain_video_model_flow.to_deployment(  # type: ignore[arg-type]
            name="production",
            tags=["model-retrain", "medium-priority"],
        ),
    )
