"""Layout CRUD endpoints for layout.db management."""

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import Auth
from app.models.layout import (
    AnalysisResultsUpdate,
    BatchCreateResponse,
    BoxLabelCreate,
    BoxLabelBatchCreate,
    BoxLabelListResponse,
    BoxLabelResponse,
    DeleteResponse,
    LabelSource,
    VideoLayoutConfigInit,
    VideoLayoutConfigResponse,
    VideoLayoutConfigUpdate,
    VideoPreferencesResponse,
    VideoPreferencesUpdate,
)
from app.repositories.layout import LayoutRepository
from app.services.database_manager import get_layout_database_manager

router = APIRouter()


# =============================================================================
# Video Layout Config Endpoints
# =============================================================================


@router.get("/{video_id}/layout/config", response_model=VideoLayoutConfigResponse)
async def get_layout_config(video_id: str, auth: Auth):
    """
    Get video layout configuration.

    Returns crop bounds, selection region, and analysis results.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            config = repo.get_layout_config()
            if config is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Layout config not initialized",
                )
            return VideoLayoutConfigResponse(config=config)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.post(
    "/{video_id}/layout/config",
    response_model=VideoLayoutConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def init_layout_config(video_id: str, body: VideoLayoutConfigInit, auth: Auth):
    """
    Initialize video layout configuration with frame dimensions.

    This should be called when first setting up layout for a video.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_or_create_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            config = repo.init_layout_config(body)
            return VideoLayoutConfigResponse(config=config)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/{video_id}/layout/config", response_model=VideoLayoutConfigResponse)
async def update_layout_config(video_id: str, body: VideoLayoutConfigUpdate, auth: Auth):
    """
    Update crop bounds and selection region.

    Partial updates are supported - only provide fields to update.
    Changing crop bounds will increment cropBoundsVersion.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            config = repo.update_layout_config(body)
            if config is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Layout config not initialized",
                )
            return VideoLayoutConfigResponse(config=config)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.put("/{video_id}/layout/config/analysis", response_model=VideoLayoutConfigResponse)
async def update_analysis_results(video_id: str, body: AnalysisResultsUpdate, auth: Auth):
    """
    Update layout analysis results from ML model.

    This endpoint is typically called by the layout analysis pipeline
    after processing the video frames.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            config = repo.update_analysis_results(body)
            if config is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Layout config not initialized",
                )
            return VideoLayoutConfigResponse(config=config)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


# =============================================================================
# Box Label Endpoints
# =============================================================================


@router.get("/{video_id}/layout/labels", response_model=BoxLabelListResponse)
async def get_box_labels(
    video_id: str,
    auth: Auth,
    frame: int | None = Query(None, description="Filter by frame index"),
    source: LabelSource | None = Query(None, description="Filter by label source"),
    limit: int | None = Query(None, description="Maximum number of labels"),
):
    """
    List box labels with optional filtering.

    Use frame parameter to get labels for a specific frame.
    Use source parameter to filter by 'user' or 'model' labels.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            labels = repo.list_box_labels(frame, source, limit)
            return BoxLabelListResponse(labels=labels)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.get("/{video_id}/layout/labels/{label_id}", response_model=BoxLabelResponse)
async def get_box_label(video_id: str, label_id: int, auth: Auth):
    """Get a single box label by ID."""
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            label = repo.get_box_label(label_id)
            if label is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Box label {label_id} not found",
                )
            return BoxLabelResponse(label=label)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.post(
    "/{video_id}/layout/labels",
    response_model=BoxLabelResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_box_label(video_id: str, body: BoxLabelCreate, auth: Auth):
    """
    Create or update a box label.

    If a label already exists for the same frame, box, and source,
    it will be updated with the new label value.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            label = repo.create_box_label(body)
            return BoxLabelResponse(label=label)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.post(
    "/{video_id}/layout/labels/batch",
    response_model=BatchCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_box_labels_batch(video_id: str, body: BoxLabelBatchCreate, auth: Auth):
    """
    Create multiple box labels in a single request.

    Useful for setting labels from model predictions or bulk user input.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            labels = repo.create_box_labels_batch(body.labels)
            return BatchCreateResponse(created=len(labels), labels=labels)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.delete("/{video_id}/layout/labels/{label_id}", response_model=DeleteResponse)
async def delete_box_label(video_id: str, label_id: int, auth: Auth):
    """Delete a box label by ID."""
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            deleted = repo.delete_box_label(label_id)
            if not deleted:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Box label {label_id} not found",
                )
            return DeleteResponse(deleted=True)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.delete("/{video_id}/layout/labels", response_model=DeleteResponse)
async def delete_box_labels_by_source(
    video_id: str,
    auth: Auth,
    source: LabelSource = Query(..., description="Label source to delete"),
):
    """
    Delete all box labels from a specific source.

    Useful for clearing model predictions before re-running analysis.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            count = repo.delete_box_labels_by_source(source)
            return DeleteResponse(deleted=count > 0)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


# =============================================================================
# Video Preferences Endpoints
# =============================================================================


@router.get("/{video_id}/layout/preferences", response_model=VideoPreferencesResponse)
async def get_preferences(video_id: str, auth: Auth):
    """Get video preferences."""
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = LayoutRepository(conn)
            preferences = repo.get_preferences()
            return VideoPreferencesResponse(preferences=preferences)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.put("/{video_id}/layout/preferences", response_model=VideoPreferencesResponse)
async def update_preferences(video_id: str, body: VideoPreferencesUpdate, auth: Auth):
    """
    Update video preferences.

    Set layoutApproved=true when the user confirms the layout is correct.
    """
    db_manager = get_layout_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id, writable=True) as conn:
            repo = LayoutRepository(conn)
            preferences = repo.update_preferences(body)
            return VideoPreferencesResponse(preferences=preferences)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )
