"""Action endpoints for video processing operations."""

from fastapi import APIRouter, HTTPException, status

from app.dependencies import Auth
from app.models.actions import (
    AnalyzeLayoutResponse,
    BulkAnnotateAction,
    BulkAnnotateRequest,
    BulkAnnotateResponse,
    CalculatePredictionsResponse,
    RetryRequest,
    RetryResponse,
    TriggerProcessingRequest,
    TriggerProcessingResponse,
)
from app.models.layout import BoxLabel, BoxLabelCreate, LabelSource
from app.repositories.layout import LayoutRepository
from app.repositories.ocr import OcrRepository
from app.services.database_manager import (
    get_layout_database_manager,
    get_ocr_database_manager,
)

router = APIRouter()


@router.post("/{video_id}/actions/bulk-annotate", response_model=BulkAnnotateResponse)
async def bulk_annotate(video_id: str, body: BulkAnnotateRequest, auth: Auth):
    """
    Bulk annotate boxes in a rectangle.

    Marks all boxes within the specified rectangle as in, out, or clears them.
    Can apply to a single frame or all frames with OCR data.
    """
    if body.frame is None and not body.allFrames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'frame' or 'allFrames: true' must be specified",
        )

    ocr_db_manager = get_ocr_database_manager()
    layout_db_manager = get_layout_database_manager()

    boxes_modified = 0
    frames_affected = set()

    try:
        # Get OCR data to find boxes within rectangle
        async with ocr_db_manager.get_database(auth.tenant_id, video_id) as ocr_conn:
            ocr_repo = OcrRepository(ocr_conn)

            if body.allFrames:
                # Get all frame indices
                frame_indices = ocr_repo.get_frame_indices()
            else:
                frame_indices = [body.frame]

            # Find boxes within rectangle for each frame
            boxes_to_annotate: list[tuple[int, int]] = []  # (frame_index, box_index)

            for frame_idx in frame_indices:
                detections = ocr_repo.list_detections(frame_index=frame_idx)
                for detection in detections:
                    if detection.bbox is None:
                        continue

                    # Check if box center is within rectangle
                    box_center_x = (detection.bbox.left + detection.bbox.right) // 2
                    box_center_y = (detection.bbox.top + detection.bbox.bottom) // 2

                    if (
                        body.rectangle.left <= box_center_x <= body.rectangle.right
                        and body.rectangle.top <= box_center_y <= body.rectangle.bottom
                    ):
                        boxes_to_annotate.append((frame_idx, detection.boxIndex))

        if not boxes_to_annotate:
            return BulkAnnotateResponse(
                success=True,
                boxesModified=0,
                framesAffected=0,
            )

        # Apply annotations to layout database
        async with layout_db_manager.get_or_create_database(
            auth.tenant_id, video_id, writable=True
        ) as layout_conn:
            layout_repo = LayoutRepository(layout_conn)

            for frame_idx, box_idx in boxes_to_annotate:
                if body.action == BulkAnnotateAction.CLEAR:
                    # Delete user label for this box
                    existing = layout_repo.get_box_label_by_position(
                        frame_idx, box_idx, LabelSource.USER
                    )
                    if existing:
                        layout_repo.delete_box_label(existing.id)
                        boxes_modified += 1
                        frames_affected.add(frame_idx)
                else:
                    # Create/update label
                    label = (
                        BoxLabel.IN
                        if body.action == BulkAnnotateAction.MARK_IN
                        else BoxLabel.OUT
                    )
                    layout_repo.create_box_label(
                        BoxLabelCreate(
                            frameIndex=frame_idx,
                            boxIndex=box_idx,
                            label=label,
                            labelSource=LabelSource.USER,
                        )
                    )
                    boxes_modified += 1
                    frames_affected.add(frame_idx)

        return BulkAnnotateResponse(
            success=True,
            boxesModified=boxes_modified,
            framesAffected=len(frames_affected),
        )

    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.post("/{video_id}/actions/analyze-layout", response_model=AnalyzeLayoutResponse)
async def analyze_layout(video_id: str, auth: Auth):
    """
    Run layout analysis (Bayesian model on boxes).

    Analyzes OCR box positions to determine optimal caption region.
    Synchronous operation, returns updated predictions.
    """
    # TODO: Implement Bayesian layout analysis
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Layout analysis not yet implemented",
    )


@router.post(
    "/{video_id}/actions/calculate-predictions",
    response_model=CalculatePredictionsResponse,
)
async def calculate_predictions(video_id: str, auth: Auth):
    """
    Train model and cache predictions for all boxes.

    Trains a classification model on user-labeled boxes and generates
    predictions for all unlabeled boxes.
    """
    # TODO: Implement prediction calculation
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Prediction calculation not yet implemented",
    )


@router.post(
    "/{video_id}/actions/trigger-processing",
    response_model=TriggerProcessingResponse,
)
async def trigger_processing(video_id: str, body: TriggerProcessingRequest, auth: Auth):
    """
    Trigger crop + inference pipeline.

    Starts the processing pipeline on Modal. User is blocked until complete.
    """
    # TODO: Implement Prefect/Modal integration
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Processing trigger not yet implemented",
    )


@router.post("/{video_id}/actions/retry", response_model=RetryResponse)
async def retry_processing(video_id: str, body: RetryRequest, auth: Auth):
    """
    Retry a failed processing step.

    Restarts a specific step of the processing pipeline.
    """
    # TODO: Implement retry logic
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Retry processing not yet implemented",
    )
