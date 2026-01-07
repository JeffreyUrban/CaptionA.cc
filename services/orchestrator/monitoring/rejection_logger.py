"""Rejection logging and alerting for boundary inference.

Records rejected jobs in Supabase for monitoring and triggers alerts.
"""

from datetime import datetime
from typing import Literal

from services.orchestrator.supabase_client import get_supabase_client

RejectionType = Literal[
    "frame_count_exceeded",
    "cost_exceeded",
    "validation_failed",
    "rate_limited",
    "queue_full",
]


def log_rejection(
    video_id: str,
    tenant_id: str,
    rejection_type: RejectionType,
    rejection_message: str,
    frame_count: int | None = None,
    estimated_cost_usd: float | None = None,
    cropped_frames_version: int | None = None,
    model_version: str | None = None,
    priority: str | None = None,
) -> None:
    """Log a rejected inference job to Supabase for monitoring.

    This creates a permanent record of the rejection and can be used to:
    - Monitor for systematic issues (e.g., many videos exceeding limits)
    - Alert ops team when rejections occur
    - Track whether limits need adjustment
    - Audit trail for capacity planning

    Args:
        video_id: Video UUID
        tenant_id: Tenant UUID
        rejection_type: Category of rejection
        rejection_message: Human-readable explanation
        frame_count: Video frame count (if known)
        estimated_cost_usd: Estimated job cost (if calculated)
        cropped_frames_version: Frame version (if known)
        model_version: Model version (if known)
        priority: Job priority (if known)

    Note:
        This function logs but does not raise errors - failures to log
        rejections should not block the rejection itself.
    """
    try:
        supabase = get_supabase_client(schema="captionacc_production")

        # Insert rejection record
        supabase.schema("captionacc_production").table("boundary_inference_rejections").insert(
            {
                "video_id": video_id,
                "tenant_id": tenant_id,
                "rejection_type": rejection_type,
                "rejection_message": rejection_message,
                "frame_count": frame_count,
                "estimated_cost_usd": estimated_cost_usd,
                "cropped_frames_version": cropped_frames_version,
                "model_version": model_version,
                "priority": priority,
            }
        ).execute()

        # Log for immediate visibility
        print(f"🚨 REJECTION LOGGED: {rejection_type}")
        print(f"   Video: {video_id}")
        print(f"   Tenant: {tenant_id}")
        if frame_count:
            print(f"   Frame count: {frame_count:,}")
        if estimated_cost_usd:
            print(f"   Estimated cost: ${estimated_cost_usd:.4f}")
        print(f"   Message: {rejection_message}")

    except Exception as e:
        # Don't let logging failures block the rejection
        print(f"⚠️  Failed to log rejection to Supabase: {e}")
        print(f"   Rejection type: {rejection_type}")
        print(f"   Video: {video_id}")


def get_unacknowledged_rejections(limit: int = 100) -> list[dict]:
    """Get recent unacknowledged rejections for monitoring.

    Args:
        limit: Maximum number of rejections to return

    Returns:
        List of rejection records ordered by most recent
    """
    supabase = get_supabase_client(schema="captionacc_production")

    response = (
        supabase.schema("captionacc_production")
        .table("boundary_inference_rejections")
        .select("*")
        .eq("acknowledged", False)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    return response.data


def acknowledge_rejection(rejection_id: str, acknowledged_by: str | None = None) -> None:
    """Mark a rejection as acknowledged by the team.

    Args:
        rejection_id: Rejection UUID
        acknowledged_by: User ID who acknowledged (optional)
    """
    supabase = get_supabase_client(schema="captionacc_production")

    update_data = {
        "acknowledged": True,
        "acknowledged_at": datetime.utcnow().isoformat(),
    }

    if acknowledged_by:
        update_data["acknowledged_by"] = acknowledged_by

    supabase.schema("captionacc_production").table("boundary_inference_rejections").update(
        update_data
    ).eq("id", rejection_id).execute()


def get_rejection_summary(days: int = 7) -> dict:
    """Get summary statistics for rejections in last N days.

    Useful for monitoring dashboard and capacity planning.

    Args:
        days: Number of days to look back

    Returns:
        Dict with rejection counts by type and trend data
    """
    supabase = get_supabase_client(schema="captionacc_production")

    # Try to use RPC function if it exists (future optimization)
    try:
        response = supabase.rpc(
            "get_rejection_summary",
            {
                "days_back": days,
            },
        ).execute()
        if response.data:
            return response.data
    except Exception:
        # RPC doesn't exist yet, fall back to simple query
        pass

    # Fallback: Simple query with client-side aggregation
    response = (
        supabase.schema("captionacc_production")
        .table("boundary_inference_rejections")
        .select("rejection_type, created_at")
        .gte("created_at", f"now() - interval '{days} days'")
        .execute()
    )

    # Aggregate by type
    summary = {}
    for record in response.data:
        rejection_type = record["rejection_type"]
        summary[rejection_type] = summary.get(rejection_type, 0) + 1

    return {
        "days": days,
        "total_rejections": len(response.data),
        "by_type": summary,
    }
