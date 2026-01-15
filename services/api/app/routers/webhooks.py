"""Webhook endpoints for external integrations."""

import logging
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.config import get_settings
from app.services.priority_service import calculate_flow_priority, get_priority_tags

logger = logging.getLogger(__name__)
router = APIRouter()


class SupabaseWebhookPayload(BaseModel):
    """Supabase webhook payload structure."""

    type: str  # INSERT, UPDATE, DELETE
    table: str  # Table name
    record: dict[str, Any]  # The inserted/updated/deleted record
    old_record: dict[str, Any] | None = None  # For UPDATE/DELETE events


class WebhookResponse(BaseModel):
    """Response for webhook endpoint."""

    success: bool
    flow_run_id: str | None = None
    status: str
    message: str | None = None


def verify_webhook_auth(authorization: str | None) -> None:
    """
    Verify webhook authentication.

    Args:
        authorization: Authorization header value

    Raises:
        HTTPException: If authentication fails
    """
    settings = get_settings()

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    # Expect "Bearer {webhook_secret}"
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0] != "Bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected 'Bearer <token>'",
        )

    token = parts[1]
    if token != settings.webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook secret",
        )


async def trigger_prefect_flow(
    flow_name: str,
    parameters: dict[str, Any],
    priority: int,
    tags: list[str],
) -> dict[str, Any]:
    """
    Trigger a Prefect flow run via Prefect API.

    Args:
        flow_name: Name of the Prefect flow to trigger
        parameters: Flow parameters
        priority: Flow run priority (0-100)
        tags: Flow run tags

    Returns:
        Dictionary containing flow_run_id and status

    Raises:
        HTTPException: If Prefect API call fails
    """
    settings = get_settings()

    if not settings.prefect_api_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prefect API URL not configured",
        )

    # Prefect Cloud API endpoint for creating deployments runs by flow name
    # For simplicity, we'll use the flow runs endpoint directly
    url = f"{settings.prefect_api_url}/deployments/name/{flow_name}/create_flow_run"

    payload = {
        "parameters": parameters,
        "tags": tags,
        "priority": priority,
    }

    headers = {}
    if settings.prefect_api_key:
        headers["Authorization"] = f"Bearer {settings.prefect_api_key}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            result = response.json()

            logger.info(
                f"Triggered Prefect flow '{flow_name}' with parameters {parameters}, "
                f"priority={priority}, flow_run_id={result.get('id')}"
            )

            return {
                "flow_run_id": result.get("id"),
                "status": result.get("state", {}).get("type", "SCHEDULED"),
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"Prefect API returned error: {e.response.status_code} {e.response.text}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to trigger Prefect flow: {e.response.text}",
        )
    except httpx.RequestError as e:
        logger.error(f"Failed to connect to Prefect API: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to Prefect API: {str(e)}",
        )


@router.post("/webhooks/supabase/videos", response_model=WebhookResponse)
async def supabase_videos_webhook(
    request: Request,
    response: Response,
    authorization: str | None = Header(None),
):
    """
    Handle Supabase webhook for videos table events.

    This endpoint is called by Supabase when videos are inserted/updated/deleted.
    For INSERT events, it triggers the video initial processing flow.

    Authentication:
        - Requires Authorization header: "Bearer {webhook_secret}"
        - webhook_secret is configured via WEBHOOK_SECRET env var

    Payload format:
        {
            "type": "INSERT",
            "table": "videos",
            "record": {
                "id": "video-uuid",
                "tenant_id": "tenant-uuid",
                "storage_key": "tenant-123/client/videos/video-456/video.mp4",
                "status": "uploading",
                "created_at": "2024-01-12T00:00:00Z",
                ...
            }
        }

    Returns:
        202 Accepted with flow_run_id and status
        401 Unauthorized if authentication fails
        400 Bad Request if payload is invalid
        503 Service Unavailable if Prefect API is not configured
    """
    # Verify authentication
    verify_webhook_auth(authorization)

    # Parse payload
    try:
        body = await request.json()
        payload = SupabaseWebhookPayload(**body)
    except Exception as e:
        logger.error(f"Invalid webhook payload: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid webhook payload: {str(e)}",
        )

    # Validate table
    if payload.table != "videos":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid table '{payload.table}'. Expected 'videos'",
        )

    # Only handle INSERT events
    if payload.type != "INSERT":
        logger.info(f"Ignoring {payload.type} event for videos table")
        return WebhookResponse(
            success=True,
            status="ignored",
            message=f"Event type {payload.type} is not handled",
        )

    # Extract required fields from record
    try:
        video_id = payload.record["id"]
        tenant_id = payload.record["tenant_id"]
        storage_key = payload.record["storage_key"]
    except KeyError as e:
        logger.error(f"Missing required field in record: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required field in record: {str(e)}",
        )

    # Get tenant tier for priority calculation (default to "free" if not available)
    tenant_tier = payload.record.get("tenant_tier", "free")

    # Calculate priority using priority service
    created_at_str = payload.record.get("created_at")
    request_time = None
    if created_at_str:
        try:
            request_time = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        except ValueError:
            logger.warning(f"Could not parse created_at timestamp: {created_at_str}")

    priority = calculate_flow_priority(
        tenant_tier=tenant_tier,
        request_time=request_time,
        enable_age_boosting=True,
    )

    # Generate tags for observability
    tags = get_priority_tags(
        priority=priority,
        tenant_id=tenant_id,
        tenant_tier=tenant_tier,
        age_boosting_enabled=True,
    )
    tags.append("trigger:webhook")
    tags.append("event:video-insert")

    # Trigger Prefect flow
    flow_name = "captionacc-video-initial-processing"
    parameters = {
        "video_id": video_id,
        "tenant_id": tenant_id,
        "storage_key": storage_key,
    }

    logger.info(
        f"Triggering video initial processing for video {video_id} "
        f"(tenant: {tenant_id}, priority: {priority})"
    )

    try:
        result = await trigger_prefect_flow(
            flow_name=flow_name,
            parameters=parameters,
            priority=priority,
            tags=tags,
        )

        response.status_code = status.HTTP_202_ACCEPTED
        return WebhookResponse(
            success=True,
            flow_run_id=result["flow_run_id"],
            status="accepted",
            message=f"Flow run created with priority {priority}",
        )

    except HTTPException:
        # Re-raise HTTP exceptions (already formatted)
        raise
    except Exception as e:
        logger.error(f"Unexpected error triggering flow: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )
