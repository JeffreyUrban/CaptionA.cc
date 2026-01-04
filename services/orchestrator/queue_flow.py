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
            flow_run = await run_deployment(
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

            flow_run = await run_deployment(
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


if __name__ == "__main__":
    app()
