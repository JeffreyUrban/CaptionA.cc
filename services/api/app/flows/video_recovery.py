"""
Video Recovery Flow

Automatically finds and retries videos that failed to get picked up for processing.
This flow runs on a schedule to ensure no videos are left stuck.

Flow: captionacc-video-recovery
Schedule: Every 15 minutes
Duration: 10-60 seconds

Steps:
1. Query for videos in "uploading" or "pending" status older than 10 minutes
2. For each stuck video, trigger video_initial_processing flow
3. Log results for monitoring
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from prefect import flow, get_run_logger, task
from prefect.client.orchestration import get_client


@task(name="find-stuck-videos", retries=2, retry_delay_seconds=30)
async def find_stuck_videos(age_minutes: int = 10) -> list[dict[str, Any]]:
    """
    Find videos stuck in initial processing (layout_status = 'wait').

    Args:
        age_minutes: Consider videos older than this many minutes

    Returns:
        List of stuck video records
    """
    import httpx

    logger = get_run_logger()

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    supabase_schema = os.getenv("SUPABASE_SCHEMA", "public")

    if not supabase_url or not supabase_key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

    # Calculate cutoff time
    cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
    cutoff_iso = cutoff_time.isoformat()

    logger.info(f"Searching for videos stuck since {cutoff_iso}")

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
        response = await client.get(
            "/videos",
            params={
                "select": "id,tenant_id,display_path,layout_status,uploaded_at",
                "layout_status": "eq.wait",
                "uploaded_at": f"lt.{cutoff_iso}",
                "order": "uploaded_at.asc",
            },
        )

        if response.status_code != 200:
            raise Exception(
                f"Failed to query videos: {response.status_code} {response.text}"
            )

        stuck_videos = response.json()
        logger.info(f"Found {len(stuck_videos)} stuck video(s)")

        return stuck_videos


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
        # Get deployment by name
        deployment = await client.read_deployment_by_name(
            "captionacc-video-initial-processing/captionacc-video-initial-processing"
        )

        # Create flow run
        flow_run = await client.create_flow_run_from_deployment(
            deployment_id=deployment.id,
            parameters={
                "video_id": video_id,
                "tenant_id": tenant_id,
                "storage_key": storage_key,
            },
            tags=["recovery", "auto-retry"],
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
    name="captionacc-video-recovery",
    log_prints=True,
    retries=1,
    retry_delay_seconds=60,
)
async def video_recovery(age_minutes: int = 10) -> dict[str, Any]:
    """
    Find and retry stuck videos.

    Args:
        age_minutes: Consider videos older than this many minutes

    Returns:
        Recovery summary with counts
    """
    logger = get_run_logger()

    logger.info(f"Starting video recovery flow (age threshold: {age_minutes} minutes)")

    # Find stuck videos
    stuck_videos = await find_stuck_videos(age_minutes=age_minutes)

    if not stuck_videos:
        logger.info("No stuck videos found")
        return {
            "total": 0,
            "success": 0,
            "failed": 0,
            "videos": [],
        }

    logger.info(f"Attempting to recover {len(stuck_videos)} video(s)")

    results = []
    success_count = 0
    skipped_count = 0
    failed_count = 0

    for video in stuck_videos:
        video_id = video["id"]
        tenant_id = video["tenant_id"]
        # Compute storage_key since it's no longer stored in database
        storage_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"
        display_path = video.get("display_path") or video_id

        try:
            logger.info(f"Retrying video: {display_path} (ID: {video_id})")

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
            logger.error(f"Failed to recover video {video_id}: {e}")
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
        "total": len(stuck_videos),
        "success": success_count,
        "skipped": skipped_count,
        "failed": failed_count,
        "videos": results,
    }

    logger.info(
        f"Recovery complete: {success_count} triggered, {skipped_count} skipped, {failed_count} failed"
    )

    return summary
