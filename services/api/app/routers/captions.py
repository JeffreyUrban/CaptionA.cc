"""Caption CRUD endpoints for caption frame extents management."""

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import Auth
from app.models.captions import (
    BatchCreateData,
    BatchError,
    BatchOperationType,
    BatchRequest,
    BatchResponse,
    BatchResultItem,
    CaptionCreate,
    CaptionListResponse,
    CaptionResponse,
    CaptionTextUpdate,
    CaptionUpdate,
    DeleteResponse,
    OverlapResolutionResponse,
)
from app.repositories.captions import CaptionRepository
from app.services.database_manager import get_database_manager

router = APIRouter()


@router.get("/{video_id}/captions", response_model=CaptionListResponse)
async def get_captions(
    video_id: str,
    auth: Auth,
    start: int | None = Query(None, description="Start frame index (optional)"),
    end: int | None = Query(None, description="End frame index (optional)"),
    workable: bool = Query(False, description="Only return gaps or pending captions"),
    limit: int | None = Query(None, description="Maximum number of captions"),
):
    """
    Get all captions for a video.

    Optionally filter by frame range [start, end] or workable status.
    Without start/end, returns all captions.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            captions = repo.list_captions(start, end, workable, limit)
            return CaptionListResponse(captions=captions)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.post("/{video_id}/captions/batch", response_model=BatchResponse)
async def batch_captions(
    video_id: str,
    body: BatchRequest,
    auth: Auth,
):
    """
    Apply batch of caption operations atomically.

    Client computes overlap resolution and sends all changes in one request.
    Server validates and applies operations in order. If any operation fails,
    the entire batch is rolled back.

    Operations:
    - create: { op: "create", data: { startFrameIndex, endFrameIndex, ... } }
    - update: { op: "update", id: 123, data: { startFrameIndex?, endFrameIndex?, ... } }
    - delete: { op: "delete", id: 123 }
    """
    if not body.operations:
        return BatchResponse(success=True, results=[])

    db_manager = get_database_manager()

    try:
        async with db_manager.get_or_create_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            results: list[BatchResultItem] = []

            # Process each operation
            for idx, operation in enumerate(body.operations):
                try:
                    if operation.op == BatchOperationType.CREATE:
                        # Validate create operation
                        if operation.data is None:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="Create operation requires 'data' field",
                                ),
                            )
                        if not isinstance(operation.data, BatchCreateData):
                            # Try to parse as BatchCreateData
                            try:
                                create_data = BatchCreateData.model_validate(
                                    operation.data.model_dump()
                                )
                            except Exception:
                                return BatchResponse(
                                    success=False,
                                    error=BatchError(
                                        index=idx,
                                        op=operation.op,
                                        message="Invalid data for create operation",
                                    ),
                                )
                        else:
                            create_data = operation.data

                        # Validate frame indices
                        if create_data.startFrameIndex < 0:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="startFrameIndex must be non-negative",
                                ),
                            )
                        if create_data.endFrameIndex <= create_data.startFrameIndex:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="endFrameIndex must be greater than startFrameIndex",
                                ),
                            )

                        # Create caption
                        caption_create = CaptionCreate(
                            startFrameIndex=create_data.startFrameIndex,
                            endFrameIndex=create_data.endFrameIndex,
                            captionFrameExtentsState=create_data.captionFrameExtentsState,
                            text=create_data.text,
                        )
                        caption = repo.create_caption(caption_create)
                        results.append(BatchResultItem(op=operation.op, id=caption.id))

                    elif operation.op == BatchOperationType.UPDATE:
                        # Validate update operation
                        if operation.id is None:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="Update operation requires 'id' field",
                                ),
                            )
                        if operation.data is None:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="Update operation requires 'data' field",
                                ),
                            )

                        # Check caption exists
                        existing = repo.get_caption(operation.id)
                        if existing is None:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message=f"Caption {operation.id} not found",
                                ),
                            )

                        # Build update dict from data
                        update_data = operation.data.model_dump(exclude_none=True)

                        # Validate frame indices if provided
                        start_idx = update_data.get(
                            "startFrameIndex", existing.startFrameIndex
                        )
                        end_idx = update_data.get(
                            "endFrameIndex", existing.endFrameIndex
                        )
                        if start_idx < 0:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="startFrameIndex must be non-negative",
                                ),
                            )
                        if end_idx <= start_idx:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="endFrameIndex must be greater than startFrameIndex",
                                ),
                            )

                        # Update caption directly (no overlap resolution)
                        repo.update_caption_simple(operation.id, update_data)
                        results.append(
                            BatchResultItem(op=operation.op, id=operation.id)
                        )

                    elif operation.op == BatchOperationType.DELETE:
                        # Validate delete operation
                        if operation.id is None:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message="Delete operation requires 'id' field",
                                ),
                            )

                        # Delete caption
                        deleted = repo.delete_caption(operation.id)
                        if not deleted:
                            return BatchResponse(
                                success=False,
                                error=BatchError(
                                    index=idx,
                                    op=operation.op,
                                    message=f"Caption {operation.id} not found",
                                ),
                            )
                        results.append(
                            BatchResultItem(op=operation.op, id=operation.id)
                        )

                except Exception as e:
                    # Rollback happens automatically when context exits without commit
                    return BatchResponse(
                        success=False,
                        error=BatchError(
                            index=idx,
                            op=operation.op,
                            message=str(e),
                        ),
                    )

            # All operations succeeded - commit happens on context exit
            return BatchResponse(success=True, results=results)

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.get("/{video_id}/captions/{caption_id}", response_model=CaptionResponse)
async def get_caption(video_id: str, caption_id: int, auth: Auth):
    """Get a single caption by ID."""
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            caption = repo.get_caption(caption_id)
            if caption is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Caption {caption_id} not found",
                )
            return CaptionResponse(caption=caption)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.post(
    "/{video_id}/captions",
    response_model=CaptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_caption(video_id: str, body: CaptionCreate, auth: Auth):
    """
    Create a new caption.

    Note: This does NOT perform overlap resolution. The client should
    use PUT to update an existing caption if overlap resolution is needed.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_or_create_database(auth.tenant_id, video_id) as conn:
            repo = CaptionRepository(conn)
            caption = repo.create_caption(body)
            return CaptionResponse(caption=caption)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put(
    "/{video_id}/captions/{caption_id}", response_model=OverlapResolutionResponse
)
async def update_caption(
    video_id: str, caption_id: int, body: CaptionUpdate, auth: Auth
):
    """
    Update caption frame extents with automatic overlap resolution.

    This endpoint handles the complex overlap resolution logic:
    - Captions completely contained in the new range are deleted
    - Overlapping captions are trimmed or split
    - Gap captions are created for uncovered ranges when shrinking

    The response includes all affected captions for client-side state updates.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(
            auth.tenant_id, video_id, writable=True
        ) as conn:
            repo = CaptionRepository(conn)
            try:
                result = repo.update_caption_with_overlap_resolution(caption_id, body)
                return result
            except ValueError as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=str(e),
                )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.put("/{video_id}/captions/{caption_id}/text", response_model=CaptionResponse)
async def update_caption_text(
    video_id: str, caption_id: int, body: CaptionTextUpdate, auth: Auth
):
    """
    Update caption text content.

    Use this endpoint to set the caption text after caption frame extents editing.
    Also accepts optional textStatus and textNotes fields.
    """
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(
            auth.tenant_id, video_id, writable=True
        ) as conn:
            repo = CaptionRepository(conn)
            caption = repo.update_caption_text(caption_id, body)
            if caption is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Caption {caption_id} not found",
                )
            return CaptionResponse(caption=caption)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.delete("/{video_id}/captions/{caption_id}", response_model=DeleteResponse)
async def delete_caption(video_id: str, caption_id: int, auth: Auth):
    """Delete a caption."""
    db_manager = get_database_manager()

    try:
        async with db_manager.get_database(
            auth.tenant_id, video_id, writable=True
        ) as conn:
            repo = CaptionRepository(conn)
            deleted = repo.delete_caption(caption_id)
            if not deleted:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Caption {caption_id} not found",
                )
            return DeleteResponse(deleted=True)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )
