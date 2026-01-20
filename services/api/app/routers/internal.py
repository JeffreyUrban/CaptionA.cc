"""Internal endpoints for system operations."""

import logging

from fastapi import APIRouter, HTTPException, status
from prefect.client.orchestration import get_client
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class ProcessNewVideosResponse(BaseModel):
    """Response for process new videos trigger endpoint."""

    success: bool
    flow_run_id: str | None = None
    status: str
    message: str | None = None


@router.post("/internal/process-new-videos/trigger", response_model=ProcessNewVideosResponse)
async def trigger_process_new_videos():
    """
    Trigger process new videos flow to check for and process waiting videos.

    This endpoint is called by:
    1. Supercronic scheduler (every 15 minutes, fallback)
    2. Realtime subscription handler (immediate, on INSERT)

    Returns:
        202 Accepted with flow_run_id if successful
        500 Internal Server Error if Prefect API fails
    """
    logger.info("Process new videos trigger endpoint called")

    # Trigger the flow with default parameters (age_minutes=0 means all waiting videos)
    parameters = {
        "age_minutes": 0,
    }
    tags = [
        "process-new-videos",
        "trigger:internal-endpoint",
    ]

    try:
        async with get_client() as client:
            # Get deployment by name (format: "flow-name/deployment-name")
            deployment = await client.read_deployment_by_name(
                "captionacc-process-new-videos/captionacc-process-new-videos"
            )

            # Create flow run
            flow_run = await client.create_flow_run_from_deployment(
                deployment_id=deployment.id,
                parameters=parameters,
                tags=tags,
            )

            logger.info(
                f"Process new videos flow triggered: flow_run_id={flow_run.id}"
            )

            return ProcessNewVideosResponse(
                success=True,
                flow_run_id=str(flow_run.id),
                status="accepted",
                message="Process new videos flow triggered",
            )

    except Exception as e:
        logger.error(f"Failed to trigger process new videos flow: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to trigger process new videos flow: {str(e)}",
        )
