#!/usr/bin/env python3
"""
CLI tool to queue Prefect flows.

This is called by TypeScript app via spawn() instead of running a separate API server.

Usage:
    python queue_flow.py full-frames --video-id UUID --video-path /path --db-path /path --output-dir /path
    python queue_flow.py crop-frames --video-id UUID --video-path /path --db-path /path --output-dir /path --crop-bounds '{"left":0,"top":0,"right":100,"bottom":100}'
"""

import asyncio
import json
import sys

import typer
from prefect.deployments import run_deployment

app = typer.Typer()


@app.command("full-frames")
def queue_full_frames(
    video_id: str,
    video_path: str,
    db_path: str,
    output_dir: str,
    frame_rate: float = 0.1,
):
    """Queue full frames processing (background job)."""

    async def _queue():
        try:
            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            # In reality it's async and returns Awaitable[FlowRun]
            flow_run = await run_deployment(  # type: ignore[misc]
                name="process-video-initial/production",
                parameters={
                    "video_id": video_id,
                    "video_path": video_path,
                    "db_path": db_path,
                    "output_dir": output_dir,
                    "frame_rate": frame_rate,
                },
                timeout=0,
                tags=["background", "low-priority"],
            )

            # Output JSON for TypeScript to parse (camelCase for API consistency)
            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
                "priority": "background",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("crop-frames")
def queue_crop_frames(
    video_id: str,
    video_path: str,
    db_path: str,
    output_dir: str,
    crop_bounds: str,  # JSON string: '{"left":0,"top":0,"right":100,"bottom":100}'
    crop_bounds_version: int = 1,
    frame_rate: float = 10.0,
):
    """Queue crop frames processing (user-initiated job)."""

    async def _queue():
        try:
            # Parse crop bounds JSON
            bounds = json.loads(crop_bounds)

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="crop-video-frames/production",
                parameters={
                    "video_id": video_id,
                    "video_path": video_path,
                    "db_path": db_path,
                    "output_dir": output_dir,
                    "crop_bounds": bounds,
                    "crop_bounds_version": crop_bounds_version,
                    "frame_rate": frame_rate,
                },
                timeout=0,
                tags=["user-initiated", "high-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
                "priority": "user-initiated",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("caption-median-ocr")
def queue_caption_median_ocr(
    video_id: str,
    db_path: str,
    video_dir: str,
    caption_ids: str,  # JSON array string: '[1, 2, 3]'
    language: str = "zh-Hans",
):
    """Queue caption median OCR processing (user-initiated job)."""

    async def _queue():
        try:
            # Parse caption IDs JSON array
            ids = json.loads(caption_ids)

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="process-caption-median-ocr/production",
                parameters={
                    "video_id": video_id,
                    "db_path": db_path,
                    "video_dir": video_dir,
                    "caption_ids": ids,
                    "language": language,
                },
                timeout=0,
                tags=["user-initiated", "high-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
                "priority": "user-initiated",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("update-base-model")
def queue_update_base_model(
    data_dir: str,
    training_source: str = "all_videos",
    retrain_videos: bool = True,
):
    """Queue base model update (admin/maintenance job)."""

    async def _queue():
        try:
            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="update-base-model-globally/production",
                parameters={
                    "data_dir": data_dir,
                    "training_source": training_source,
                    "retrain_videos": retrain_videos,
                },
                timeout=0,
                tags=["admin", "base-model", "low-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
                "priority": "admin",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("retrain-video-model")
def queue_retrain_video_model(
    video_id: str,
    db_path: str,
    update_predictions: bool = True,
):
    """Queue video model retrain (user-initiated or batch job)."""

    async def _queue():
        try:
            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="retrain-video-model/production",
                parameters={
                    "video_id": video_id,
                    "db_path": db_path,
                    "update_predictions": update_predictions,
                },
                timeout=0,
                tags=["model-retrain", "medium-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
                "priority": "medium",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("upload-and-process")
def queue_upload_and_process(
    video_path: str,
    video_id: str,
    filename: str,
    file_size: int,
    tenant_id: str = "00000000-0000-0000-0000-000000000001",
    frame_rate: float = 0.1,
    uploaded_by_user_id: str | None = None,
):
    """Queue upload and processing (Wasabi-based workflow with split databases)."""

    async def _queue():
        try:
            parameters = {
                "local_video_path": video_path,
                "video_id": video_id,
                "filename": filename,
                "file_size": file_size,
                "tenant_id": tenant_id,
                "frame_rate": frame_rate,
            }

            # Add optional parameter only if provided
            if uploaded_by_user_id:
                parameters["uploaded_by_user_id"] = uploaded_by_user_id

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="upload-and-process-video/production",
                parameters=parameters,
                timeout=0,
                tags=["upload", "processing", "high-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
                "priority": "high",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


if __name__ == "__main__":
    app()
