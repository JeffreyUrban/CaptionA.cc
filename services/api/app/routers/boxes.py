"""Consolidated boxes endpoint merging OCR data with annotations."""

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import Auth
from app.models.boxes import (
    BoxAnnotation,
    BoxAnnotationsUpdate,
    BoxesResponse,
    BoxesUpdateResponse,
    FrameBoxes,
)
from app.models.layout import BoxLabel, BoxLabelCreate, LabelSource
from app.repositories.layout import LayoutRepository
from app.repositories.ocr import OcrRepository
from app.services.database_manager import (
    get_layout_database_manager,
    get_ocr_database_manager,
)

router = APIRouter()


@router.get("/{video_id}/boxes", response_model=BoxesResponse)
async def get_boxes(
    video_id: str,
    auth: Auth,
    frame: int = Query(..., description="Frame index to get boxes for"),
):
    """
    Get OCR boxes for a frame with predictions and user annotations.

    Returns all OCR detections for the frame, merged with any user labels
    or model predictions from the layout database.
    """
    ocr_db_manager = get_ocr_database_manager()
    layout_db_manager = get_layout_database_manager()

    # Get OCR detections for the frame
    try:
        async with ocr_db_manager.get_database(auth.tenant_id, video_id) as ocr_conn:
            ocr_repo = OcrRepository(ocr_conn)
            detections = ocr_repo.list_detections(frame_index=frame)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OCR database not found for video {video_id}",
        )

    if not detections:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No OCR data for frame {frame}",
        )

    # Get labels for the frame (if layout database exists)
    user_labels: dict[int, BoxLabel] = {}
    model_predictions: dict[int, BoxLabel] = {}

    try:
        async with layout_db_manager.get_database(
            auth.tenant_id, video_id
        ) as layout_conn:
            layout_repo = LayoutRepository(layout_conn)
            labels = layout_repo.list_box_labels(frame_index=frame)
            for label in labels:
                if label.labelSource == LabelSource.USER:
                    user_labels[label.boxIndex] = label.label
                elif label.labelSource == LabelSource.MODEL:
                    model_predictions[label.boxIndex] = label.label
    except FileNotFoundError:
        # Layout database doesn't exist yet, no labels available
        pass

    # Merge OCR detections with labels
    boxes: list[BoxAnnotation] = []
    for detection in detections:
        box = BoxAnnotation(
            boxIndex=detection.boxIndex,
            text=detection.text,
            confidence=detection.confidence,
            bbox=detection.bbox,
            userLabel=user_labels.get(detection.boxIndex),
            modelPrediction=model_predictions.get(detection.boxIndex),
        )
        boxes.append(box)

    return BoxesResponse(
        frame=FrameBoxes(
            frameIndex=frame,
            boxes=boxes,
            totalBoxes=len(boxes),
        )
    )


@router.put("/{video_id}/boxes", response_model=BoxesUpdateResponse)
async def update_boxes(
    video_id: str,
    body: BoxAnnotationsUpdate,
    auth: Auth,
    frame: int = Query(..., description="Frame index to update boxes for"),
):
    """
    Save box annotations for a frame.

    Updates user labels for the specified boxes. Labels are stored in the
    layout database and will be returned on subsequent GET requests.
    """
    layout_db_manager = get_layout_database_manager()

    try:
        async with layout_db_manager.get_or_create_database(
            auth.tenant_id, video_id, writable=True
        ) as layout_conn:
            layout_repo = LayoutRepository(layout_conn)

            # Create/update labels for each annotation
            for annotation in body.annotations:
                layout_repo.create_box_label(
                    BoxLabelCreate(
                        frameIndex=frame,
                        boxIndex=annotation.boxIndex,
                        label=annotation.status,
                        labelSource=LabelSource.USER,
                    )
                )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )

    # Return updated frame data
    return await _get_updated_frame(auth, video_id, frame, len(body.annotations))


async def _get_updated_frame(
    auth: Auth, video_id: str, frame: int, updated_count: int
) -> BoxesUpdateResponse:
    """Helper to get updated frame data after a PUT operation."""
    ocr_db_manager = get_ocr_database_manager()
    layout_db_manager = get_layout_database_manager()

    # Get fresh OCR detections
    async with ocr_db_manager.get_database(auth.tenant_id, video_id) as ocr_conn:
        ocr_repo = OcrRepository(ocr_conn)
        detections = ocr_repo.list_detections(frame_index=frame)

    # Get fresh labels
    user_labels: dict[int, BoxLabel] = {}
    model_predictions: dict[int, BoxLabel] = {}

    try:
        async with layout_db_manager.get_database(
            auth.tenant_id, video_id
        ) as layout_conn:
            layout_repo = LayoutRepository(layout_conn)
            labels = layout_repo.list_box_labels(frame_index=frame)
            for label in labels:
                if label.labelSource == LabelSource.USER:
                    user_labels[label.boxIndex] = label.label
                elif label.labelSource == LabelSource.MODEL:
                    model_predictions[label.boxIndex] = label.label
    except FileNotFoundError:
        pass

    # Merge
    boxes: list[BoxAnnotation] = []
    for detection in detections:
        box = BoxAnnotation(
            boxIndex=detection.boxIndex,
            text=detection.text,
            confidence=detection.confidence,
            bbox=detection.bbox,
            userLabel=user_labels.get(detection.boxIndex),
            modelPrediction=model_predictions.get(detection.boxIndex),
        )
        boxes.append(box)

    return BoxesUpdateResponse(
        updated=updated_count,
        frame=FrameBoxes(
            frameIndex=frame,
            boxes=boxes,
            totalBoxes=len(boxes),
        ),
    )
