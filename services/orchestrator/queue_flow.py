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
from pathlib import Path

# Load environment variables from monorepo root
from dotenv import load_dotenv

monorepo_root = Path(__file__).parent.parent.parent
env_path = monorepo_root / ".env"
if env_path.exists():
    load_dotenv(env_path)

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


@app.command("crop-frames-to-webm")
def queue_crop_frames_to_webm(
    video_id: str,
    crop_bounds: str,  # JSON string: '{"left":0,"top":0,"right":100,"bottom":100}'
    tenant_id: str = "00000000-0000-0000-0000-000000000001",
    filename: str | None = None,
    frame_rate: float = 10.0,
    created_by_user_id: str | None = None,
):
    """Queue cropped frames WebM chunking (versioned frameset generation)."""

    async def _queue():
        try:
            # Parse crop bounds JSON
            bounds = json.loads(crop_bounds)

            parameters = {
                "video_id": video_id,
                "tenant_id": tenant_id,
                "crop_bounds": bounds,
                "frame_rate": frame_rate,
            }

            # Add optional parameters only if provided
            if filename:
                parameters["filename"] = filename
            if created_by_user_id:
                parameters["created_by_user_id"] = created_by_user_id

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="crop-frames-to-webm/production",
                parameters=parameters,
                timeout=0,
                tags=["crop-frames", "webm", "user-initiated", "high-priority"],
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


@app.command("download-for-layout-annotation")
def queue_download_for_layout_annotation(
    video_id: str,
    output_dir: str,
    tenant_id: str = "00000000-0000-0000-0000-000000000001",
):
    """Queue download of files needed for layout annotation."""

    async def _queue():
        try:
            parameters = {
                "video_id": video_id,
                "output_dir": output_dir,
                "tenant_id": tenant_id,
            }

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="download-for-layout-annotation/production",
                parameters=parameters,
                timeout=0,
                tags=["download", "layout-annotation", "user-initiated"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("upload-layout-db")
def queue_upload_layout_db(
    video_id: str,
    layout_db_path: str,
    tenant_id: str = "00000000-0000-0000-0000-000000000001",
    trigger_crop_regen: bool = True,
):
    """Queue upload of annotated layout.db to Wasabi."""

    async def _queue():
        try:
            parameters = {
                "video_id": video_id,
                "layout_db_path": layout_db_path,
                "tenant_id": tenant_id,
                "trigger_crop_regen": trigger_crop_regen,
            }

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="upload-layout-db/production",
                parameters=parameters,
                timeout=0,
                tags=["upload", "layout-annotation", "user-initiated", "high-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("download-for-caption-annotation")
def queue_download_for_caption_annotation(
    video_id: str,
    output_dir: str,
    tenant_id: str = "00000000-0000-0000-0000-000000000001",
):
    """Queue download of captions.db for caption annotation."""

    async def _queue():
        try:
            parameters = {
                "video_id": video_id,
                "output_dir": output_dir,
                "tenant_id": tenant_id,
            }

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="download-for-caption-annotation/production",
                parameters=parameters,
                timeout=0,
                tags=["download", "caption-annotation", "user-initiated"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
            }
            print(json.dumps(result))
            return 0

        except Exception as e:
            error = {"error": str(e), "status": "failed"}
            print(json.dumps(error), file=sys.stderr)
            return 1

    exit_code = asyncio.run(_queue())
    sys.exit(exit_code)


@app.command("upload-captions-db")
def queue_upload_captions_db(
    video_id: str,
    captions_db_path: str,
    tenant_id: str = "00000000-0000-0000-0000-000000000001",
):
    """Queue upload of annotated captions.db to Wasabi."""

    async def _queue():
        try:
            parameters = {
                "video_id": video_id,
                "captions_db_path": captions_db_path,
                "tenant_id": tenant_id,
            }

            # Prefect type stubs incorrectly type run_deployment as returning FlowRun directly
            flow_run = await run_deployment(  # type: ignore[misc]
                name="upload-captions-db/production",
                parameters=parameters,
                timeout=0,
                tags=["upload", "caption-annotation", "user-initiated", "high-priority"],
            )

            result = {
                "flowRunId": str(flow_run.id),
                "status": "queued",
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
