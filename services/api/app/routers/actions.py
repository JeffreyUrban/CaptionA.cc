"""Action endpoints for video processing operations."""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, status

from app.config import get_settings
from app.dependencies import Auth
from app.models.actions import (
    AnalyzeLayoutResponse,
    BoxPrediction,
    BulkAnnotateAction,
    BulkAnnotateRequest,
    BulkAnnotateResponse,
    CalculatePredictionsResponse,
    LayoutParams,
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
    get_layout_server_database_manager,
    get_ocr_database_manager,
)
from app.services.priority_service import calculate_flow_priority, get_priority_tags
from app.services.supabase_service import SupabaseServiceImpl

logger = logging.getLogger(__name__)

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
            elif body.frame is not None:
                frame_indices = [body.frame]
            else:
                frame_indices = []

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
            auth.tenant_id, video_id
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

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database not found for video {video_id}",
        )


@router.post("/{video_id}/actions/analyze-layout", response_model=AnalyzeLayoutResponse)
async def analyze_layout(video_id: str, auth: Auth):
    """
    Run layout analysis (Bayesian model on boxes).

    Analyzes OCR box positions to determine optimal caption region.
    Downloads layout.db from Wasabi, runs Bayesian analysis to calculate
    layout parameters (vertical position, anchor type, etc.), and uploads
    updated database back to Wasabi.

    Synchronous operation, returns updated predictions.
    """
    import time

    from app.services.layout_analysis import analyze_ocr_boxes, update_layout_config

    start_time = time.time()
    layout_db_manager = get_layout_database_manager()

    try:
        # Download layout.db from Wasabi and get writable connection
        async with layout_db_manager.get_database(
            auth.tenant_id, video_id, writable=True
        ) as conn:
            # Get frame dimensions from layout config
            cursor = conn.cursor()
            config_row = cursor.execute(
                "SELECT frame_width, frame_height FROM layout_config WHERE id = 1"
            ).fetchone()

            if not config_row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Layout config not found for video {video_id}",
                )

            frame_width, frame_height = config_row

            # Count total boxes for response
            boxes_count = cursor.execute("SELECT COUNT(*) FROM boxes").fetchone()[0]

            logger.info(
                f"Running Bayesian analysis on {boxes_count} boxes "
                f"for video {video_id} (frame size: {frame_width}x{frame_height})"
            )

            # Run Bayesian analysis
            layout_params = analyze_ocr_boxes(conn, frame_width, frame_height)

            # Update layout config with calculated parameters
            update_layout_config(conn, layout_params)

            logger.info(
                f"Layout analysis complete for video {video_id}: "
                f"anchor_type={layout_params.anchor_type}, "
                f"vertical_position={layout_params.vertical_position}"
            )

        # Database automatically uploaded to Wasabi on exit (writable=True)

        elapsed_ms = int((time.time() - start_time) * 1000)

        return AnalyzeLayoutResponse(
            success=True,
            boxesAnalyzed=boxes_count,
            processingTimeMs=elapsed_ms,
            layoutParams=LayoutParams(
                verticalPosition=layout_params.vertical_position,
                verticalStd=layout_params.vertical_std,
                boxHeight=layout_params.box_height,
                boxHeightStd=layout_params.box_height_std,
                anchorType=layout_params.anchor_type,
                anchorPosition=layout_params.anchor_position,
            ),
        )

    except ValueError as e:
        # No OCR boxes found
        logger.error(f"Layout analysis failed for video {video_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.post(
    "/{video_id}/actions/calculate-predictions",
    response_model=CalculatePredictionsResponse,
)
async def calculate_predictions(video_id: str, auth: Auth):
    """
    Calculate predictions for all boxes using Bayesian model.

    Uses layout.db for boxes/layout config and layout-server.db for model data.
    Initializes seed model if none exists, then runs predictions for all boxes.
    """
    import time
    from datetime import datetime, timezone

    from ocr_box_model import (
        initialize_seed_model,
        load_layout_config,
        load_model,
        predict_with_heuristics,
        run_model_migrations,
    )
    from ocr_box_model.types import BoxBounds

    start_time = time.time()
    layout_db_manager = get_layout_database_manager()
    layout_server_db_manager = get_layout_server_database_manager()

    try:
        # Open both databases - layout.db for boxes, layout-server.db for model
        async with layout_db_manager.get_database(
            auth.tenant_id, video_id, writable=True
        ) as layout_conn:
            async with layout_server_db_manager.get_or_create_database(
                auth.tenant_id, video_id
            ) as model_conn:
                # Run model migrations on layout-server.db
                run_model_migrations(model_conn)

                # Initialize seed model if none exists (on layout-server.db)
                initialize_seed_model(model_conn)

                # Load layout config from layout.db
                layout = load_layout_config(layout_conn)
                if not layout:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Layout config not found for video {video_id}",
                    )

                # Load model from layout-server.db
                model = load_model(model_conn)
                model_version = model.model_version if model else "heuristics"

                # Get all boxes from boxes table (layout.db)
                cursor = layout_conn.cursor()
                rows = cursor.execute(
                    """
                    SELECT frame_index, box_index, text, bbox_left, bbox_top, bbox_right, bbox_bottom
                    FROM boxes
                    ORDER BY frame_index, box_index
                    """
                ).fetchall()

                if not rows:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No OCR boxes found in database",
                    )

                logger.info(
                    f"Calculating predictions for {len(rows)} boxes in video {video_id}"
                )

                # Prepare predictions
                predictions_to_save: list[tuple[str, float, str, str, int, int]] = []
                now = datetime.now(timezone.utc).isoformat()

                for row in rows:
                    (
                        frame_index,
                        box_index,
                        text,
                        bbox_left,
                        bbox_top,
                        bbox_right,
                        bbox_bottom,
                    ) = row

                    # Convert fractional coordinates to pixels
                    # boxes table stores normalized coords (0-1) with top > bottom (top of screen is higher y)
                    left = int(bbox_left * layout.frame_width)
                    top = int((1 - bbox_top) * layout.frame_height)
                    right = int(bbox_right * layout.frame_width)
                    bottom = int((1 - bbox_bottom) * layout.frame_height)

                    # Create BoxBounds for prediction
                    box_bounds = BoxBounds(
                        left=left,
                        top=top,
                        right=right,
                        bottom=bottom,
                        frame_index=frame_index,
                        box_index=box_index,
                        text=text or "",
                    )

                    # Use heuristics for initial predictions (no user annotations yet)
                    prediction = predict_with_heuristics(box_bounds, layout)

                    predictions_to_save.append(
                        (
                            prediction.label,
                            prediction.confidence,
                            model_version,
                            now,
                            frame_index,
                            box_index,
                        )
                    )

                # Batch update predictions in boxes table (layout.db)
                cursor.executemany(
                    """
                    UPDATE boxes
                    SET predicted_label = ?,
                        predicted_confidence = ?
                    WHERE frame_index = ? AND box_index = ?
                    """,
                    [
                        (label, conf, frame_idx, box_idx)
                        for label, conf, _model, _time, frame_idx, box_idx in predictions_to_save
                    ],
                )
                layout_conn.commit()

                elapsed_ms = int((time.time() - start_time) * 1000)

                logger.info(
                    f"Calculated {len(predictions_to_save)} predictions for video {video_id} "
                    f"in {elapsed_ms}ms using {model_version}"
                )

                # Convert predictions to response format
                prediction_results = [
                    BoxPrediction(
                        frameIndex=frame_idx,
                        boxIndex=box_idx,
                        predictedLabel=label,
                        predictedConfidence=conf,
                    )
                    for label, conf, _model, _time, frame_idx, box_idx in predictions_to_save
                ]

                return CalculatePredictionsResponse(
                    success=True,
                    predictionsGenerated=len(predictions_to_save),
                    modelVersion=model_version,
                    predictions=prediction_results,
                )

    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout database not found for video {video_id}",
        )


@router.post(
    "/{video_id}/actions/approve-layout",
    response_model=TriggerProcessingResponse,
)
async def approve_layout(video_id: str, body: TriggerProcessingRequest, auth: Auth):
    """
    Approve layout and trigger crop + inference pipeline.

    Triggers the crop-and-infer-caption-frame-extents Prefect deployment
    which crops frames, runs caption frame extents inference, and creates captions.db.
    """
    settings = get_settings()

    if not settings.prefect_api_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prefect API URL not configured",
        )

    # Initialize Supabase service to get video metadata and tenant tier
    supabase = SupabaseServiceImpl(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key,
        schema=settings.supabase_schema,
    )

    # Get video metadata to get creation time for priority calculation
    try:
        video_metadata = supabase.get_video_metadata(video_id)
        if not video_metadata:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Video {video_id} not found",
            )
    except Exception as e:
        logger.error(f"Failed to get video metadata: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get video metadata: {str(e)}",
        )

    # Get tenant tier for priority calculation
    try:
        tenant_tier = supabase.get_tenant_tier(auth.tenant_id)
    except Exception as e:
        logger.warning(f"Failed to get tenant tier, defaulting to 'free': {e}")
        tenant_tier = "free"

    # Parse creation time for age-based priority boosting
    request_time = None
    if video_metadata.get("created_at"):
        try:
            created_at_str = video_metadata["created_at"]
            # Handle both ISO format with Z and timezone info
            request_time = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        except (ValueError, TypeError) as e:
            logger.warning(f"Could not parse created_at timestamp: {e}")

    # Calculate priority for flow run
    priority = calculate_flow_priority(
        tenant_tier=tenant_tier,
        request_time=request_time,
        enable_age_boosting=True,  # Enable age boosting by default
    )

    # Update layout_status to 'done' - user has approved the layout
    try:
        supabase.update_video_workflow_status(
            video_id=video_id,
            layout_status="done",
        )
        logger.info(f"Updated layout_status to 'done' for video {video_id}")
    except Exception as e:
        logger.error(f"Failed to update layout_status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update layout status: {str(e)}",
        )

    # Generate tags for observability
    tags = get_priority_tags(
        priority=priority,
        tenant_id=auth.tenant_id,
        tenant_tier=tenant_tier,
        age_boosting_enabled=True,
    )
    tags.extend(["trigger:user-action", "action:approve-layout"])

    # Build deployment path for crop and infer flow (uses namespace from config)
    deployment_path = settings.get_deployment_full_name(
        "crop-and-infer-caption-frame-extents"
    )

    # Prepare flow parameters
    parameters = {
        "video_id": video_id,
        "tenant_id": auth.tenant_id,
        "crop_region": body.crop_region.model_dump(),
    }

    # Build Prefect API URL
    url = (
        f"{settings.prefect_api_url}/deployments/name/{deployment_path}/create_flow_run"
    )

    # Prepare request payload
    payload = {
        "parameters": parameters,
        "tags": tags,
        "priority": priority,
    }

    # Add authorization header if API key is configured
    headers = {"Content-Type": "application/json"}
    if settings.prefect_api_key:
        headers["Authorization"] = f"Bearer {settings.prefect_api_key}"

    logger.info(
        f"Triggering {deployment_path} for video {video_id} "
        f"(tenant: {auth.tenant_id}, priority: {priority})"
    )

    # Call Prefect API to create flow run
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            result = response.json()

            flow_run_id = result.get("id")
            flow_state = result.get("state", {})
            flow_status = flow_state.get("type", "SCHEDULED")

            logger.info(
                f"Successfully triggered flow run {flow_run_id} "
                f"with status {flow_status}"
            )

            return TriggerProcessingResponse(
                success=True,
                jobId=flow_run_id,
                status=flow_status,
            )

    except httpx.HTTPStatusError as e:
        logger.error(
            f"Prefect API returned error: {e.response.status_code} {e.response.text}"
        )
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
