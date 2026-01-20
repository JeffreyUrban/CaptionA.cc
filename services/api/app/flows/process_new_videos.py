"""
Process New Videos Flow

Finds videos waiting to be processed (layout_status = 'wait') and triggers processing.

Primary trigger: Realtime subscription on videos table INSERT (immediate processing)
Recovery fallback: Cron job every 15 minutes catches any missed events

Flow: captionacc-process-new-videos
Duration: 10-60 seconds

Steps:
1. Query for videos with layout_status = 'wait'
2. For each video, trigger video_initial_processing flow
3. Log results for monitoring
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from prefect import flow, get_run_logger, task
from prefect.client.orchestration import get_client

from app.config import get_settings


@task(name="find-new-videos", retries=2, retry_delay_seconds=30)
async def find_new_videos(age_minutes: int = 0) -> list[dict[str, Any]]:
    """
    Find videos waiting to be processed (layout_status = 'wait').

    Args:
        age_minutes: Only consider videos older than this many minutes (0 = all)

    Returns:
        List of video records to process
    """
    import httpx

    logger = get_run_logger()

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    supabase_schema = os.getenv("SUPABASE_SCHEMA", "public")

    if not supabase_url or not supabase_key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

    # Calculate cutoff time (if age_minutes > 0)
    if age_minutes > 0:
        cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
        cutoff_iso = cutoff_time.isoformat()
        logger.info(f"Searching for videos waiting since {cutoff_iso}")
    else:
        cutoff_iso = None
        logger.info("Searching for all videos waiting to be processed")

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    # Add schema header if not using public schema
    if supabase_schema and supabase_schema != "public":
        headers["Accept-Profile"] = supabase_schema
        headers["Content-Profile"] = supabase_schema

    async with httpx.AsyncClient(
        base_url=f"{supabase_url}/rest/v1",
        headers=headers,
        timeout=30.0,
    ) as client:
        params = {
            "select": "id,tenant_id,display_path,layout_status,uploaded_at",
            "layout_status": "eq.wait",
            "order": "uploaded_at.asc",
        }
        if cutoff_iso:
            params["uploaded_at"] = f"lt.{cutoff_iso}"

        response = await client.get("/videos", params=params)

        if response.status_code != 200:
            raise Exception(
                f"Failed to query videos: {response.status_code} {response.text}"
            )

        new_videos = response.json()
        logger.info(f"Found {len(new_videos)} video(s) to process")

        return new_videos


@task(name="check-existing-flow-runs", retries=1, retry_delay_seconds=10)
async def check_existing_flow_runs(video_id: str) -> dict[str, Any]:
    """
    Check if video is already being processed or was recently processed.

    Args:
        video_id: Video UUID to check

    Returns:
        Dict with status and info about existing runs
    """
    from prefect.client.schemas.objects import StateType

    logger = get_run_logger()

    async with get_client() as client:
        # Look for recent flow runs (last 30 minutes)
        flow_runs = await client.read_flow_runs(
            limit=100,
        )

        # Filter for runs with matching video_id parameter
        matching_runs = []
        for run in flow_runs:
            params = run.parameters or {}
            if params.get("video_id") == video_id:
                matching_runs.append(run)

        if not matching_runs:
            return {"has_runs": False, "can_retry": True}

        # Check if any runs are currently active
        active_states = {
            StateType.PENDING,
            StateType.RUNNING,
            StateType.SCHEDULED,
        }

        active_runs = [run for run in matching_runs if run.state_type in active_states]

        if active_runs:
            logger.warning(
                f"Video {video_id} has {len(active_runs)} active flow run(s) - skipping retry"
            )
            return {
                "has_runs": True,
                "can_retry": False,
                "reason": "active_flow_runs",
                "active_runs": [str(run.id) for run in active_runs],
            }

        # Check for recent completed runs (last 5 minutes)
        recent_cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
        recent_runs = [
            run
            for run in matching_runs
            if run.end_time and run.end_time > recent_cutoff
        ]

        if recent_runs:
            logger.warning(
                f"Video {video_id} was recently processed ({len(recent_runs)} run(s) in last 5 minutes) - skipping retry"
            )
            return {
                "has_runs": True,
                "can_retry": False,
                "reason": "recently_processed",
                "recent_runs": [str(run.id) for run in recent_runs],
            }

        # Has runs but they're old/failed - safe to retry
        return {
            "has_runs": True,
            "can_retry": True,
            "old_runs": [str(run.id) for run in matching_runs],
        }


@task(name="trigger-video-processing", retries=1, retry_delay_seconds=10)
async def trigger_video_processing(
    video_id: str, tenant_id: str, storage_key: str
) -> dict[str, Any]:
    """
    Trigger video_initial_processing flow via Prefect API.

    Includes race condition protection - checks for existing runs first.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        storage_key: Wasabi storage key

    Returns:
        Flow run info or skip info
    """
    logger = get_run_logger()

    # Check for existing/recent flow runs to avoid race conditions
    existing_check = await check_existing_flow_runs(video_id)

    if not existing_check["can_retry"]:
        logger.info(f"Skipping video {video_id}: {existing_check.get('reason')}")
        return {
            "video_id": video_id,
            "status": "skipped",
            "reason": existing_check.get("reason"),
        }

    async with get_client() as client:
        # Get deployment by name (uses namespace from config)
        settings = get_settings()
        deployment = await client.read_deployment_by_name(
            settings.get_deployment_full_name("video-initial-processing")
        )

        # Create flow run
        flow_run = await client.create_flow_run_from_deployment(
            deployment_id=deployment.id,
            parameters={
                "video_id": video_id,
                "tenant_id": tenant_id,
                "storage_key": storage_key,
            },
            tags=["process-new-videos", "auto-triggered"],
        )

        logger.info(
            f"Triggered flow run {flow_run.id} for video {video_id} ({storage_key})"
        )

        return {
            "flow_run_id": str(flow_run.id),
            "video_id": video_id,
            "status": "triggered",
        }


@flow(
    name="captionacc-process-new-videos",
    log_prints=True,
    retries=1,
    retry_delay_seconds=60,
)
async def process_new_videos(age_minutes: int = 0) -> dict[str, Any]:
    """
    Find and process new videos waiting in queue.

    Args:
        age_minutes: Only consider videos older than this many minutes (0 = all)

    Returns:
        Processing summary with counts
    """
    logger = get_run_logger()

    logger.info(f"Starting process new videos flow (age threshold: {age_minutes} minutes)")

    # Find videos to process
    new_videos = await find_new_videos(age_minutes=age_minutes)

    if not new_videos:
        logger.info("No new videos to process")
        return {
            "total": 0,
            "success": 0,
            "failed": 0,
            "videos": [],
        }

    logger.info(f"Processing {len(new_videos)} video(s)")

    results = []
    success_count = 0
    skipped_count = 0
    failed_count = 0

    for video in new_videos:
        video_id = video["id"]
        tenant_id = video["tenant_id"]
        # Compute storage_key since it's no longer stored in database
        storage_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"
        display_path = video.get("display_path") or video_id

        try:
            logger.info(f"Processing video: {display_path} (ID: {video_id})")

            result = await trigger_video_processing(
                video_id=video_id,
                tenant_id=tenant_id,
                storage_key=storage_key,
            )

            results.append(result)

            if result.get("status") == "skipped":
                skipped_count += 1
            else:
                success_count += 1

        except Exception as e:
            logger.error(f"Failed to process video {video_id}: {e}")
            results.append(
                {
                    "video_id": video_id,
                    "status": "failed",
                    "error": str(e),
                }
            )
            failed_count += 1

    # Summary
    summary = {
        "total": len(new_videos),
        "success": success_count,
        "skipped": skipped_count,
        "failed": failed_count,
        "videos": results,
    }

    logger.info(
        f"Processing complete: {success_count} triggered, {skipped_count} skipped, {failed_count} failed"
    )

    return summary
