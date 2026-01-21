#!/usr/bin/env python3
"""
Find videos that failed to get picked up for processing.

A video is considered "stuck" if:
- Status is "uploading" or "pending"
- Created more than 10 minutes ago
- Has not been processed yet

Usage:
    python scripts/find_stuck_videos.py
    python scripts/find_stuck_videos.py --age-minutes 30
    python scripts/find_stuck_videos.py --json
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

import httpx


def get_supabase_client():
    """Initialize Supabase client from environment."""
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    supabase_schema = os.getenv("SUPABASE_SCHEMA", "public")

    if not supabase_url or not supabase_key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
    }

    # Add schema header if not using public schema
    if supabase_schema and supabase_schema != "public":
        headers["Accept-Profile"] = supabase_schema
        headers["Content-Profile"] = supabase_schema

    return httpx.Client(
        base_url=f"{supabase_url}/rest/v1",
        headers=headers,
        timeout=30.0,
    )


def find_stuck_videos(age_minutes: int = 10) -> list[dict]:
    """
    Find videos that are stuck in uploading/pending status.

    Args:
        age_minutes: Consider videos older than this many minutes

    Returns:
        List of stuck video records
    """
    client = get_supabase_client()

    # Calculate cutoff time (videos older than this are considered stuck)
    cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
    cutoff_iso = cutoff_time.isoformat()

    # Query for stuck videos
    # Status should be "uploading" or "processing" AND uploaded before cutoff
    response = client.get(
        "/videos",
        params={
            "select": "id,tenant_id,display_path,status,uploaded_at",
            "status": "in.(uploading,processing)",
            "uploaded_at": f"lt.{cutoff_iso}",
            "order": "uploaded_at.asc",
        },
    )

    if response.status_code != 200:
        print(f"ERROR: Failed to query videos: {response.status_code} {response.text}")
        sys.exit(1)

    return response.json()


def main():
    parser = argparse.ArgumentParser(
        description="Find videos stuck in processing queue"
    )
    parser.add_argument(
        "--age-minutes",
        type=int,
        default=10,
        help="Consider videos older than N minutes (default: 10)",
    )
    parser.add_argument(
        "--json", action="store_true", help="Output as JSON instead of table"
    )

    args = parser.parse_args()

    print(f"Searching for videos stuck for >{args.age_minutes} minutes...\n")

    stuck_videos = find_stuck_videos(age_minutes=args.age_minutes)

    if not stuck_videos:
        print("✓ No stuck videos found!")
        return

    print(f"Found {len(stuck_videos)} stuck video(s):\n")

    if args.json:
        import json

        print(json.dumps(stuck_videos, indent=2))
    else:
        # Print table
        print(f"{'ID':<38} {'Display Path':<40} {'Status':<12} {'Age':<15}")
        print("-" * 110)

        for video in stuck_videos:
            uploaded_at = datetime.fromisoformat(
                video["uploaded_at"].replace("Z", "+00:00")
            )
            age = datetime.now(timezone.utc) - uploaded_at
            age_str = f"{int(age.total_seconds() / 60)}m ago"

            # Use display_path if available, otherwise show shortened video ID
            display = video.get("display_path") or f"video-{video['id'][:8]}..."

            print(
                f"{video['id']:<38} {display:<40} {video['status']:<12} {age_str:<15}"
            )

        print("\nTo retry these videos, run:")
        print("  python scripts/retry_stuck_videos.py")


if __name__ == "__main__":
    main()
