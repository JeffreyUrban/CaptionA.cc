"""Action endpoints: trigger processing jobs via Prefect."""

from fastapi import APIRouter

from app.dependencies import Auth
from app.models.requests import CropFramesRequest, ExportRequest, FullFramesRequest, InferenceRequest
from app.models.responses import JobResponse

router = APIRouter()


@router.post("/{video_id}/full-frames", response_model=JobResponse)
async def trigger_full_frames(video_id: str, body: FullFramesRequest, auth: Auth):
    """
    Trigger full frame extraction + OCR.

    Runs on Modal GPU: FFmpeg frame extraction followed by OCR.
    Results stored in Wasabi, job status in Supabase.
    """
    # TODO: Implement - trigger Prefect flow
    raise NotImplementedError


@router.post("/{video_id}/crop-frames", response_model=JobResponse)
async def trigger_crop_frames(video_id: str, body: CropFramesRequest, auth: Auth):
    """
    Trigger crop frame extraction + boundaries inference.

    Runs on Modal GPU: FFmpeg crop extraction followed by inference.
    Results stored in captions.db, job status in Supabase.
    """
    # TODO: Implement - trigger Prefect flow
    raise NotImplementedError


@router.post("/{video_id}/inference", response_model=JobResponse)
async def trigger_inference(video_id: str, body: InferenceRequest, auth: Auth):
    """
    Trigger boundaries inference on existing crop frames.

    Use when re-running inference without re-extracting frames.
    """
    # TODO: Implement - trigger Prefect flow
    raise NotImplementedError


@router.post("/{video_id}/export", response_model=JobResponse)
async def trigger_export(video_id: str, body: ExportRequest, auth: Auth):
    """
    Trigger video export with burned-in captions.

    Runs on Modal GPU: FFmpeg with caption overlay.
    """
    # TODO: Implement - trigger Prefect flow
    raise NotImplementedError
