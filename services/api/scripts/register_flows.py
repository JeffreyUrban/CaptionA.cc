#!/usr/bin/env python3
"""
Register Prefect flows as deployments.

This script creates deployments for all CaptionA.cc flows in the
captionacc-workers work pool.
"""

import asyncio
import os
import sys


async def register_deployments():
    """Register all flow deployments with Prefect server."""
    # Import flows
    from app.flows.video_initial_processing import video_initial_processing
    from app.flows.crop_and_infer import crop_and_infer
    from app.flows.caption_ocr import caption_ocr

    print("Registering Prefect flow deployments...")

    # Define deployments using Prefect 3.x flow.deploy() API
    deployments = [
        {
            "flow": video_initial_processing,
            "name": "captionacc-video-initial-processing",
            "work_pool_name": "captionacc-workers",
            "description": "Extract frames and run OCR on uploaded videos",
        },
        {
            "flow": crop_and_infer,
            "name": "captionacc-crop-and-infer-caption-frame-extents",
            "work_pool_name": "captionacc-workers",
            "description": "Crop frames and infer caption boundaries",
        },
        {
            "flow": caption_ocr,
            "name": "captionacc-caption-ocr",
            "work_pool_name": "captionacc-workers",
            "description": "Generate OCR for individual captions",
        },
    ]

    # Create deployments using Prefect 3.x API
    for deployment_config in deployments:
        print(f"\nRegistering: {deployment_config['name']}")

        # Use flow.deploy() with build=False for local code
        # The code is available in the worker environment
        deployment_id = await deployment_config["flow"].deploy(
            name=deployment_config["name"],
            work_pool_name=deployment_config["work_pool_name"],
            description=deployment_config["description"],
            build=False,  # Code is already available in worker
        )

        print(f"  ✓ Deployed with ID: {deployment_id}")

    print("\n✓ All deployments registered successfully!")


if __name__ == "__main__":
    # Ensure required environment variables are set
    required_vars = ["PREFECT_API_URL"]
    missing = [var for var in required_vars if not os.getenv(var)]

    if missing:
        print(f"Error: Missing required environment variables: {', '.join(missing)}")
        print("\nSet them with:")
        print("  export PREFECT_API_URL=https://banchelabs-gateway.fly.dev/api")
        sys.exit(1)

    print(f"Connecting to Prefect server: {os.getenv('PREFECT_API_URL')}")

    asyncio.run(register_deployments())
