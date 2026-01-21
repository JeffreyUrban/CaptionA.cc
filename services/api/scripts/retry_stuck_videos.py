#!/usr/bin/env python3
"""
Retry processing for stuck videos.

This script triggers the video_initial_processing flow for videos that
failed to be picked up by the Realtime subscription or cron recovery.

Usage:
    # Retry all stuck videos (older than 10 minutes)
    python scripts/retry_stuck_videos.py

    # Retry specific video by ID
    python scripts/retry_stuck_videos.py --video-id <uuid>

    # Dry run (show what would be retried)
    python scripts/retry_stuck_videos.py --dry-run

    # Custom age threshold
    python scripts/retry_stuck_videos.py --age-minutes 30
"""

import argparse
import os
import sys

import httpx

# Import the find_stuck_videos function
from find_stuck_videos import find_stuck_videos, get_supabase_client


def trigger_video_processing(
    video_id: str, tenant_id: str, storage_key: str, dry_run: bool = False
) -> dict | None:
    """
    Trigger Prefect flow for video processing.

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        storage_key: Wasabi storage key for video
        dry_run: If True, don't actually trigger, just log

    Returns:
        Flow run info if successful, None otherwise
    """
    prefect_api_url = os.getenv("PREFECT_API_URL")

    if not prefect_api_url:
        print("ERROR: PREFECT_API_URL environment variable not set")
        sys.exit(1)

    # Build deployment path (uses namespace from env, defaults to 'prod')
    namespace = os.getenv("CAPTIONACC_NAMESPACE", "") or "prod"
    flow_name = "captionacc-video-initial-processing"
    deployment_name = f"captionacc-{namespace}-video-initial-processing"
    deployment_path = f"{flow_name}/{deployment_name}"
    url = f"{prefect_api_url}/deployments/name/{deployment_path}/create_flow_run"

    payload = {
        "parameters": {
            "video_id": video_id,
            "tenant_id": tenant_id,
            "storage_key": storage_key,
        },
        "tags": ["recovery", "manual-retry"],
        "priority": 75,  # Higher priority for recovery
    }

    if dry_run:
        print(f"  [DRY RUN] Would trigger flow for video {video_id}")
        return {"id": "dry-run", "state": {"type": "DRY_RUN"}}

    try:
        response = httpx.post(url, json=payload, timeout=30.0)
        response.raise_for_status()
        result = response.json()

        print(f"  ✓ Triggered flow run {result.get('id')} for video {video_id}")
        return result

    except httpx.HTTPError as e:
        print(f"  ✗ Failed to trigger flow for video {video_id}: {e}")
        if hasattr(e, "response") and e.response:
            print(f"    Response: {e.response.text}")
        return None


def retry_single_video(video_id: str, dry_run: bool = False) -> bool:
    """
    Retry processing for a single video by ID.

    Args:
        video_id: Video UUID to retry
        dry_run: If True, don't actually trigger

    Returns:
        True if successful, False otherwise
    """
    client = get_supabase_client()

    # Fetch video details
    response = client.get(
        "/videos",
        params={
            "select": "id,display_path,tenant_id,status,uploaded_at",
            "id": f"eq.{video_id}",
        },
    )

    if response.status_code != 200:
        print(f"ERROR: Failed to fetch video: {response.status_code} {response.text}")
        return False

    videos = response.json()
    if not videos:
        print(f"ERROR: Video {video_id} not found")
        return False

    video = videos[0]

    # Compute storage_key
    storage_key = f"{video['tenant_id']}/client/videos/{video['id']}/video.mp4"
    display = video.get("display_path") or video_id

    print(f"\nRetrying video: {display} (ID: {video['id']})")
    print(f"  Status: {video['status']}")
    print(f"  Uploaded: {video['uploaded_at']}")

    result = trigger_video_processing(
        video_id=video["id"],
        tenant_id=video["tenant_id"],
        storage_key=storage_key,
        dry_run=dry_run,
    )

    return result is not None


def retry_all_stuck_videos(age_minutes: int = 10, dry_run: bool = False) -> dict:
    """
    Retry processing for all stuck videos.

    Args:
        age_minutes: Consider videos older than this many minutes
        dry_run: If True, don't actually trigger

    Returns:
        Dict with success/failure counts
    """
    stuck_videos = find_stuck_videos(age_minutes=age_minutes)

    if not stuck_videos:
        print("✓ No stuck videos found!")
        return {"total": 0, "success": 0, "failed": 0}

    print(f"Found {len(stuck_videos)} stuck video(s)\n")

    if dry_run:
        print("[DRY RUN MODE - No actual flow runs will be triggered]\n")

    success_count = 0
    failed_count = 0

    for video in stuck_videos:
        storage_key = f"{video['tenant_id']}/client/videos/{video['id']}/video.mp4"
        display = video.get("display_path") or video["id"]

        print(f"Retrying: {display} (ID: {video['id']})")

        result = trigger_video_processing(
            video_id=video["id"],
            tenant_id=video["tenant_id"],
            storage_key=storage_key,
            dry_run=dry_run,
        )

        if result:
            success_count += 1
        else:
            failed_count += 1

        print()  # Blank line between videos

    return {
        "total": len(stuck_videos),
        "success": success_count,
        "failed": failed_count,
    }


def main():
    parser = argparse.ArgumentParser(description="Retry processing for stuck videos")
    parser.add_argument(
        "--video-id",
        type=str,
        help="Retry specific video by UUID",
    )
    parser.add_argument(
        "--age-minutes",
        type=int,
        default=10,
        help="For bulk retry: consider videos older than N minutes (default: 10)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be retried without actually triggering",
    )

    args = parser.parse_args()

    # Single video retry
    if args.video_id:
        success = retry_single_video(args.video_id, dry_run=args.dry_run)
        sys.exit(0 if success else 1)

    # Bulk retry
    print(f"Searching for stuck videos (age > {args.age_minutes} minutes)...\n")

    results = retry_all_stuck_videos(age_minutes=args.age_minutes, dry_run=args.dry_run)

    # Print summary
    print("=" * 60)
    print("RETRY SUMMARY")
    print("=" * 60)
    print(f"Total videos found:    {results['total']}")
    print(f"Successfully triggered: {results['success']}")
    print(f"Failed:                {results['failed']}")

    if args.dry_run:
        print("\n(DRY RUN - No actual changes made)")

    sys.exit(0 if results["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
