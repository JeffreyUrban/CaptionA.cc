"""Internal endpoints for system operations."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status
from prefect.client.orchestration import get_client
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class RecoveryTriggerResponse(BaseModel):
    """Response for recovery trigger endpoint."""

    success: bool
    flow_run_id: str | None = None
    status: str
    message: str | None = None


@router.post("/internal/recovery/trigger", response_model=RecoveryTriggerResponse)
async def trigger_recovery():
    """
    Trigger video recovery flow to check for and retry stuck videos.

    This endpoint is designed to be called by Supercronic scheduler.
    It triggers the recovery flow asynchronously and returns immediately,
    allowing the machine to auto-stop if no other work is pending.

    Returns:
        202 Accepted with flow_run_id if successful
        503 Service Unavailable if Prefect API is not configured
    """
    logger.info("Recovery trigger endpoint called - initiating video recovery flow")

    # Trigger the recovery flow with default parameters
    parameters = {
        "age_minutes": 10,  # Check for videos stuck for >10 minutes
    }
    tags = [
        "recovery",
        "scheduled",
        "trigger:internal-endpoint",
    ]

    try:
        async with get_client() as client:
            # Get deployment by name (format: "flow-name/deployment-name")
            deployment = await client.read_deployment_by_name(
                "captionacc-video-recovery/captionacc-video-recovery"
            )

            # Create flow run
            flow_run = await client.create_flow_run_from_deployment(
                deployment_id=deployment.id,
                parameters=parameters,
                tags=tags,
            )

            logger.info(
                f"Recovery flow triggered successfully: flow_run_id={flow_run.id}"
            )

            return RecoveryTriggerResponse(
                success=True,
                flow_run_id=str(flow_run.id),
                status="accepted",
                message="Recovery flow triggered",
            )

    except Exception as e:
        logger.error(f"Failed to trigger recovery flow: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to trigger recovery flow: {str(e)}",
        )
