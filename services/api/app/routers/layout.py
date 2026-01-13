"""Consolidated layout endpoint."""

from fastapi import APIRouter, HTTPException, status

from app.dependencies import Auth
from app.models.layout import (
    AnalysisResultsUpdate,
    ConsolidatedLayout,
    LayoutResponse,
    LayoutUpdate,
    LayoutUpdateResponse,
    VideoLayoutConfigInit,
    VideoLayoutConfigUpdate,
)
from app.repositories.layout import LayoutRepository
from app.services.database_manager import get_layout_database_manager

router = APIRouter()


@router.get("/{video_id}/layout", response_model=LayoutResponse)
async def get_layout(video_id: str, auth: Auth):
    """
    Get layout configuration.

    Returns crop region, selection region, and layout analysis parameters.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            config = repo.get_layout_config()
            if config is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Layout not initialized",
                )
            return LayoutResponse(layout=ConsolidatedLayout.from_config(config))
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.put("/{video_id}/layout", response_model=LayoutUpdateResponse)
async def update_layout(video_id: str, body: LayoutUpdate, auth: Auth):
    """
    Update layout configuration.

    Supports partial updates. Updates can include:
    - cropRegion: Crop region for the video
    - selectionRegion: Selection region within the video
    - selectionMode: disabled, manual, or auto
    - layoutParams: ML analysis parameters
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)

            # Check if layout exists
            existing = repo.get_layout_config()
            if existing is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Layout not initialized",
                )

            # Build update for crop/selection region
            config_update = VideoLayoutConfigUpdate()

            if body.cropRegion is not None:
                config_update.cropLeft = body.cropRegion.left
                config_update.cropTop = body.cropRegion.top
                config_update.cropRight = body.cropRegion.right
                config_update.cropBottom = body.cropRegion.bottom

            if body.selectionRegion is not None:
                config_update.selectionLeft = body.selectionRegion.left
                config_update.selectionTop = body.selectionRegion.top
                config_update.selectionRight = body.selectionRegion.right
                config_update.selectionBottom = body.selectionRegion.bottom

            if body.selectionMode is not None:
                config_update.selectionMode = body.selectionMode

            # Apply config update if any fields were set
            if any(
                v is not None
                for v in [
                    config_update.cropLeft,
                    config_update.cropTop,
                    config_update.cropRight,
                    config_update.cropBottom,
                    config_update.selectionLeft,
                    config_update.selectionTop,
                    config_update.selectionRight,
                    config_update.selectionBottom,
                    config_update.selectionMode,
                ]
            ):
                repo.update_layout_config(config_update)

            # Update layout params if provided
            if body.layoutParams is not None:
                analysis_update = AnalysisResultsUpdate(
                    verticalPosition=body.layoutParams.verticalPosition,
                    verticalStd=body.layoutParams.verticalStd,
                    boxHeight=body.layoutParams.boxHeight,
                    boxHeightStd=body.layoutParams.boxHeightStd,
                    anchorType=body.layoutParams.anchorType,
                    anchorPosition=body.layoutParams.anchorPosition,
                    topEdgeStd=body.layoutParams.topEdgeStd,
                    bottomEdgeStd=body.layoutParams.bottomEdgeStd,
                    horizontalStdSlope=body.layoutParams.horizontalStdSlope,
                    horizontalStdIntercept=body.layoutParams.horizontalStdIntercept,
                    analysisModelVersion=body.layoutParams.analysisModelVersion,
                )
                repo.update_analysis_results(analysis_update)

            # Return updated layout
            config = repo.get_layout_config()
            return LayoutUpdateResponse(layout=ConsolidatedLayout.from_config(config))  # type: ignore

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.post("/{video_id}/layout", response_model=LayoutResponse, status_code=status.HTTP_201_CREATED)
async def init_layout(video_id: str, body: VideoLayoutConfigInit, auth: Auth):
    """
    Initialize layout with frame dimensions.

    This must be called before other layout operations.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_or_create_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            config = repo.init_layout_config(body)
            return LayoutResponse(layout=ConsolidatedLayout.from_config(config))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
